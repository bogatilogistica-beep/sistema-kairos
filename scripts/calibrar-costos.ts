/**
 * Calibra el modelo de costo de transporte contra el histórico real de facturas
 * (source-data-raw/TRANSPORTE CONTROL DE FACTURAS--TRANSPORTE.csv).
 *
 * HALLAZGO IMPORTANTE DE LA CALIBRACIÓN
 * -------------------------------------
 * El transportista NO cobra por kilómetro ni por kilo: cobra un PRECIO FIJO POR RUTA
 * (ver también source-data-raw/...--Hoja1.csv, "COSTO DE RUTA"). En el histórico:
 *   - 6 de 18 rutas tienen un único precio en todos sus viajes
 *   - la correlación entre costo y kg transportados es ruido (r entre -0.22 y +0.29)
 *
 * Por eso el modelo lineal alpha + beta*kg + gamma*km, aunque daba r2 = 0.81, sobreestimaba
 * las rutas reales en +73%: estaba ajustando un plano a una función escalón. Con kilómetros
 * reales de carretera el error se dispara en las rutas largas (Loja, Manabí, Oriente).
 *
 * Este script produce las dos cosas:
 *   1. La tabla precio-por-ruta (la que hay que usar para decidir), robusta a outliers.
 *   2. El ajuste lineal, solo como referencia para PDV nuevos sin ruta asignada.
 *
 * CONSECUENCIA OPERATIVA: como el costo es por despacho de ruta, la palanca de ahorro
 * NO es acortar kilómetros — es hacer MENOS DESPACHOS (consolidar y respetar frecuencias).
 *
 * Uso: npm run calibrar-costos
 */
import fs from "node:fs";
import path from "node:path";
import { regresionLineal } from "./regression";

const ROOT = path.resolve(__dirname, "..");
const CSV = path.join(ROOT, "source-data-raw", "TRANSPORTE CONTROL DE FACTURAS--TRANSPORTE.csv");
const CACHE_PATH = path.join(ROOT, "data", "distancias-cache.json");
const RUTAS_PATH = path.join(ROOT, "data", "rutas-actuales.json");
const OUT_PATH = path.join(ROOT, "data", "costos-historicos.json");
const DEPOT_ID = "__DEPOSITO__";

interface Viaje {
  ruta: string;
  kg: number;
  costo: number;
  numPdv: number;
  mes: number;
  anio: number;
}

function parseCsv(texto: string): Record<string, string>[] {
  const lineas = texto.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const partir = (linea: string): string[] => {
    const out: string[] = [];
    let actual = "";
    let entreComillas = false;
    for (const ch of linea) {
      if (ch === '"') entreComillas = !entreComillas;
      else if (ch === "," && !entreComillas) {
        out.push(actual);
        actual = "";
      } else actual += ch;
    }
    out.push(actual);
    return out.map((c) => c.trim());
  };
  const cab = partir(lineas[0]);
  return lineas.slice(1).map((l) => {
    const celdas = partir(l);
    const fila: Record<string, string> = {};
    cab.forEach((c, i) => (fila[c] = celdas[i] ?? ""));
    return fila;
  });
}

function mediana(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Nombres de ruta del histórico de facturas -> claves de data/rutas-actuales.json */
const ALIAS: Record<string, string> = {
  QUITO: "QUITO",
  GUAYAS: "GYE",
  GYE: "GYE",
  "MACAS-PUYO": "MCS-PYO",
  IMBABURA: "IMB",
  RIOBAMBA: "RBB",
  AMBATO: "AMB",
  CUENCA: "CUE",
  LOJA: "LOJA",
  MANABI: "MAB",
  MACHALA: "MACHLA",
  "LA MANA": "LAMANA",
  ESMERALDAS: "ESM",
  ORIENTE: "ORIENTE",
  PLAYAS: "PLAYAS",
  BOLGY: "BOLGY",
};

function kmDeRuta(claveRuta: string): number | null {
  if (!fs.existsSync(CACHE_PATH) || !fs.existsSync(RUTAS_PATH)) return null;
  const cache: Record<string, { km: number }> = JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
  const rutas: Record<string, { pdvIds: string[] }> = JSON.parse(fs.readFileSync(RUTAS_PATH, "utf-8"));
  const def = rutas[claveRuta];
  if (!def) return null;

  const km = (a: string, b: string): number | null => {
    if (a === b) return 0;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    return cache[k]?.km ?? null;
  };

  // vecino más cercano desde el depósito: aproximación suficiente para calibrar
  const pendientes = def.pdvIds.filter((id) => km(DEPOT_ID, id) !== null);
  if (!pendientes.length) return null;
  let actual = DEPOT_ID;
  let total = 0;
  while (pendientes.length) {
    let mejor = pendientes[0];
    let mejorKm = Infinity;
    for (const cand of pendientes) {
      const d = km(actual, cand);
      if (d !== null && d < mejorKm) {
        mejorKm = d;
        mejor = cand;
      }
    }
    total += mejorKm === Infinity ? 0 : mejorKm;
    actual = mejor;
    pendientes.splice(pendientes.indexOf(mejor), 1);
  }
  return total + (km(actual, DEPOT_ID) ?? 0);
}

function main() {
  const filas = parseCsv(fs.readFileSync(CSV, "utf-8"));
  const num = (v: string) => Number((v || "").replace(/[^0-9.\-]/g, "")) || 0;

  const viajes: Viaje[] = filas
    .map((f) => ({
      ruta: (f["Ruta"] ?? "").trim().toUpperCase(),
      kg: num(f["kg Transportados helados"]),
      costo: num(f["Costo del viaje"]),
      numPdv: num(f["Numero de Pdv"]),
      mes: num(f["MES"]),
      anio: num(f["AÑO"]),
    }))
    .filter((v) => v.ruta && v.costo > 0); // los costo=0 son registros incompletos

  console.log(`Viajes con costo válido: ${viajes.length} de ${filas.length}`);

  const porRuta: Record<string, any> = {};
  const grupos = new Map<string, Viaje[]>();
  for (const v of viajes) {
    if (!grupos.has(v.ruta)) grupos.set(v.ruta, []);
    grupos.get(v.ruta)!.push(v);
  }

  console.log(
    `\n${"RUTA".padEnd(14)} ${"VIAJES".padStart(6)} ${"PRECIO".padStart(8)} ${"min-max".padStart(11)} ` +
      `${"CV%".padStart(6)} ${"km".padStart(7)} ${"$/km".padStart(7)}`
  );

  for (const [ruta, vs] of [...grupos.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const costos = vs.map((v) => v.costo);
    const precio = mediana(costos);
    const media = costos.reduce((a, b) => a + b, 0) / costos.length;
    const sd = Math.sqrt(costos.reduce((a, c) => a + (c - media) ** 2, 0) / costos.length);
    const cv = media > 0 ? (sd / media) * 100 : 0;
    const km = kmDeRuta(ALIAS[ruta] ?? ruta);

    porRuta[ruta] = {
      precioRuta: precio,
      numViajes: vs.length,
      variacionPct: Math.round(cv * 10) / 10,
      avgKg: Math.round(vs.reduce((a, v) => a + v.kg, 0) / vs.length),
      avgPdv: Math.round((vs.reduce((a, v) => a + v.numPdv, 0) / vs.length) * 10) / 10,
      kmEstimados: km ? Math.round(km) : null,
      costoPorKm: km ? Math.round((precio / km) * 1000) / 1000 : null,
    };

    console.log(
      `${ruta.slice(0, 14).padEnd(14)} ${String(vs.length).padStart(6)} ${precio.toFixed(0).padStart(8)} ` +
        `${`${Math.min(...costos)}-${Math.max(...costos)}`.padStart(11)} ${cv.toFixed(1).padStart(6)} ` +
        `${(km ? km.toFixed(0) : "—").padStart(7)} ${(km ? (precio / km).toFixed(3) : "—").padStart(7)}`
    );
  }

  // Ajuste lineal, solo como respaldo para rutas nuevas sin precio pactado
  const conKm = viajes
    .map((v) => ({ ...v, km: kmDeRuta(ALIAS[v.ruta] ?? v.ruta) }))
    .filter((v): v is Viaje & { km: number } => v.km !== null);
  const reg = regresionLineal({
    y: conKm.map((v) => v.costo),
    x1: conKm.map((v) => v.kg),
    x2: conKm.map((v) => v.km),
  });

  // Error del ajuste lineal frente al precio real por ruta
  let errAbs = 0;
  for (const v of conKm) {
    const pred = reg.alpha + reg.beta * v.kg + reg.gamma * v.km;
    errAbs += Math.abs(pred - v.costo) / v.costo;
  }
  const mape = (errAbs / conKm.length) * 100;

  const gastoTotal = viajes.reduce((a, v) => a + v.costo, 0);
  const meses = new Set(viajes.map((v) => `${v.anio}-${v.mes}`)).size;

  console.log(`\nAjuste lineal (solo respaldo): alpha=${reg.alpha.toFixed(2)} beta=${reg.beta.toFixed(4)} gamma=${reg.gamma.toFixed(4)} r2=${reg.r2.toFixed(3)}`);
  console.log(`  error medio del ajuste lineal vs precio real: ${mape.toFixed(1)}%`);
  console.log(`\nGasto histórico: $${gastoTotal.toLocaleString("en-US")} en ${viajes.length} viajes / ${meses} meses`);
  console.log(`  promedio por viaje  : $${(gastoTotal / viajes.length).toFixed(0)}`);
  console.log(`  promedio por mes    : $${(gastoTotal / meses).toFixed(0)}`);
  console.log(`  viajes por mes      : ${(viajes.length / meses).toFixed(1)}`);
  console.log(`\n>> La palanca de ahorro es el NÚMERO DE DESPACHOS, no los kilómetros.`);
  console.log(`   Cada despacho evitado vale en promedio $${(gastoTotal / viajes.length).toFixed(0)}.`);

  const salida = {
    modelo: "precio-fijo-por-ruta",
    nota:
      "El transportista cobra precio fijo por ruta despachada. El costo no depende de kg ni de km. " +
      "Usar porRuta[ruta].precioRuta. La regresión lineal queda solo como respaldo para rutas sin precio pactado.",
    porRuta,
    regresion: {
      alpha: Math.round(reg.alpha * 100) / 100,
      beta: Math.round(reg.beta * 10000) / 10000,
      gamma: Math.round(reg.gamma * 10000) / 10000,
      r2: Math.round(reg.r2 * 1000) / 1000,
      errorMedioPct: Math.round(mape * 10) / 10,
      muestras: conKm.length,
    },
    resumen: {
      gastoTotalUsd: Math.round(gastoTotal),
      numViajes: viajes.length,
      meses,
      costoPromedioViajeUsd: Math.round(gastoTotal / viajes.length),
      gastoPromedioMesUsd: Math.round(gastoTotal / meses),
      viajesPorMes: Math.round((viajes.length / meses) * 10) / 10,
    },
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(salida, null, 2));
  console.log(`\n-> ${path.relative(ROOT, OUT_PATH)} actualizado`);
}

main();
