/**
 * Pipeline de datos: toma los archivos fuente de Bogati (exportados a CSV en
 * /source-data-raw, nunca se suben al repo) y produce los JSON limpios y agregados que
 * consume la plataforma en /data. Se ejecuta con `npm run generar-datos`.
 *
 * Fuentes:
 *  - MATRIZ DE UBICACIONES BOGATI: PDV, sector, coordenadas GPS, zona, estatus.
 *  - RUTAS DE TRANSPORTE 2026: ruta actual y frecuencia de entrega por PDV.
 *  - COBRO DE TRANSPORTE: tarifa fija actual que se cobra por PDV.
 *  - TRANSPORTE CONTROL DE FACTURAS: histórico real de viajes (kg, costo, ruta) + tabla
 *    de referencia de costo por ruta (Hoja1). Se usa para calibrar el modelo de costos.
 */
import fs from "node:fs";
import path from "node:path";
import { readCsvAsObjects } from "./csv";
import { parseCoordString, detectarYCorregirOutliers } from "./geo";
import { regresionLineal } from "./regression";
import { haversineKm } from "../src/lib/distance";
import { solveRouteOrder } from "../src/lib/tsp";
import type { Pdv, ConfigOptimizacion } from "../src/lib/types";

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "source-data-raw");
const OUT = path.join(ROOT, "data");
fs.mkdirSync(OUT, { recursive: true });

const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, " ");

// --- Depósito: Parque Industrial de Ambato (vía a Quito), confirmado por el equipo.
// Geocodificado con Google Places ("Parque Industrial Ambato").
const DEPOT = { lat: -1.1946871, lon: -78.5936726 };

// Alias entre el código de ruta usado en RUTAS DE TRANSPORTE 2026 y el nombre de ruta
// usado en TRANSPORTE CONTROL DE FACTURAS / Hoja1 (dos convenciones distintas para la
// misma zona operativa, inferido cruzando ambos archivos).
const ALIAS_RUTA: Record<string, string> = {
  CUE: "CUENCA",
  BOLGY: "BOLGY",
  RBB: "RIOBAMBA",
  MCHLA: "MACHALA",
  MACHLA: "MACHALA",
  LAMANA: "LA MANA",
  AMB: "AMBATO",
  ESM: "ESMERALDAS",
  GYE: "GUAYAS",
  PLAYAS: "PLAYAS",
  IMB: "IMBABURA",
  LOJA: "LOJA",
  MAB: "MANABI",
  "MCS-PYO": "MACAS-PUYO",
  ORIENTE: "ORIENTE",
  QUITO: "QUITO",
};

/** Limpia el código de ruta tal como aparece en RUTAS DE TRANSPORTE 2026 (sin mapear a
 * los nombres usados en TRANSPORTE CONTROL DE FACTURAS): trim, mayúsculas, y en casos
 * ambiguos como "MACHLA/ GYE" toma la primera ruta como principal. */
function limpiarCodigoRuta(codigo: string): string {
  let c = codigo.trim().toUpperCase();
  if (c.includes("/")) c = c.split("/")[0].trim();
  if (c === "MCHLA") c = "MACHLA"; // typo recurrente en el archivo fuente
  return c;
}

/** Nombre canónico usado en TRANSPORTE CONTROL DE FACTURAS / Hoja1 para un código de ruta. */
function nombreFactParaCodigo(codigo: string): string {
  return ALIAS_RUTA[codigo] ?? codigo;
}

// ---------- 1. MATRIZ DE UBICACIONES ----------
const matrizRows = readCsvAsObjects(
  path.join(SRC, "MATRIZ DE UBICACIONES BOGATI--UBICACION_DE_LOS_BOGATI.csv")
);

const qualityReport: Record<string, any> = {
  generadoEn: new Date().toISOString(),
  coordenadasNoParseables: [],
  coordenadasCorregidasPorSigno: [],
  pdvSinRutaAsignada: [],
  pdvEnRutasSinCoordenada: [],
  rutasNoReconocidasEnHistorico: [],
};

interface PdvRaw {
  id: string;
  sector: string;
  direccion: string;
  zona: string;
  provincia: string;
  lat: number | null;
  lon: number | null;
  coordenadaValidada: boolean;
  estatus: string;
}

const pdvsRaw: PdvRaw[] = [];
for (const row of matrizRows) {
  const nombre = row["PDV"]?.trim();
  if (!nombre) continue;
  const estatus = row["ESTATUS"]?.trim().toUpperCase() || "DESCONOCIDO";
  if (estatus !== "ACTIVO") continue;

  const provincia = nombre.split(" ")[0]; // prefijo de provincia usado en el nombre (AZUY, TUNG, GUAY, ...)
  const parsed = parseCoordString(row["UBICACIÓN MAPS"] ?? "");

  if (!parsed) {
    qualityReport.coordenadasNoParseables.push(nombre);
  }

  pdvsRaw.push({
    id: norm(nombre),
    sector: row["SECTOR"]?.trim() ?? "",
    direccion: row["DIRECCION"]?.trim() ?? "",
    zona: row["ZONA"]?.trim() ?? "",
    provincia,
    lat: parsed?.lat ?? null,
    lon: parsed?.lon ?? null,
    coordenadaValidada: !!parsed,
    estatus,
  });
}

// Fallback: PDV sin coordenada propia -> usa la de otro PDV activo de la misma ciudad
// (mismas 2 primeras palabras del nombre, ej. "CAÑR AZOGUES"), y se marca para revisión.
for (const p of pdvsRaw) {
  if (p.lat !== null) continue;
  const ciudadPrefix = p.id.split(" ").slice(0, 2).join(" ");
  const hermano = pdvsRaw.find(
    (o) => o.id !== p.id && o.lat !== null && o.id.startsWith(ciudadPrefix)
  );
  if (hermano) {
    p.lat = hermano.lat;
    p.lon = hermano.lon;
    p.coordenadaValidada = false;
  }
}

// Corrección de outliers por signo, usando la mediana provincial calculada del propio dataset
const conCoord = pdvsRaw.filter((p) => p.lat !== null) as (PdvRaw & { lat: number; lon: number })[];
const { corregidos, sospechosos } = detectarYCorregirOutliers(conCoord);
qualityReport.coordenadasCorregidasPorSigno = sospechosos;
const corregidosPorId = new Map(corregidos.map((c) => [c.id, c]));
for (const p of pdvsRaw) {
  const c = corregidosPorId.get(p.id);
  if (c) {
    p.lat = c.lat;
    p.lon = c.lon;
  }
}

// Segunda pasada de validación: compara cada PDV contra la planta (Ambato) en vez de la
// mediana provincial. Detecta el caso en que TODO un grupo de PDV comparte el mismo error
// de signo de latitud (la mediana provincial no lo detecta porque el grupo completo
// "concuerda" consigo mismo). Ecuador es angosto: invertir el signo de un PDV realmente
// ubicado al sur de Ambato siempre lo aleja del depósito, nunca lo acerca por coincidencia,
// así que "acercarse mucho al invertir el signo" es una señal confiable de error de tipeo.
for (const p of pdvsRaw) {
  if (p.lat === null || p.lon === null) continue;
  const distActual = haversineKm(DEPOT, { lat: p.lat, lon: p.lon });
  const distInvertida = haversineKm(DEPOT, { lat: -p.lat, lon: p.lon });
  if (distInvertida < distActual * 0.4 && distInvertida < 400) {
    qualityReport.coordenadasCorregidasPorSigno.push(`${p.id} (verificación planta Ambato)`);
    p.lat = -p.lat;
    p.coordenadaValidada = false;
  }
}

// ---------- 2. RUTAS DE TRANSPORTE 2026 ----------
const rutasRows = readCsvAsObjects(
  path.join(SRC, "RUTAS DE TRANSPORTE 2026--RUTAS_FRECUNCIA.csv")
);
const rutaPorPdv = new Map<
  string,
  { ruta: string; frecuenciaHelado: string; frecuenciaQuesoCrema: string; provincia: string }
>();
for (const row of rutasRows) {
  const nombre = norm(row["PUNTOS DE VENTA"] ?? "");
  if (!nombre) continue;
  rutaPorPdv.set(nombre, {
    ruta: limpiarCodigoRuta(row["RUTA"] ?? ""),
    frecuenciaHelado: row["FRECUENCIA helado"]?.trim() ?? "",
    frecuenciaQuesoCrema: row["frecuencia queso y crema"]?.trim() ?? "",
    provincia: row["PROVINCIA"]?.trim() ?? "",
  });
}

// Mapa de respaldo "prefijo de PDV -> provincia completa", derivado de los PDV que sí
// tienen ruta asignada. Se usa para los pocos PDV sin fila en RUTAS DE TRANSPORTE 2026
// (ej. altas nuevas como "AZUY PAUTE"), para que de todos modos queden agrupados en el
// clúster geográfico correcto de su provincia en vez de aislados en un grupo propio.
const provinciaPorPrefijo = new Map<string, string>();
for (const [nombre, info] of rutaPorPdv.entries()) {
  const prefijo = nombre.split(" ")[0];
  if (info.provincia && !provinciaPorPrefijo.has(prefijo)) {
    provinciaPorPrefijo.set(prefijo, info.provincia);
  }
}

// ---------- 3. COBRO DE TRANSPORTE (tarifa fija actual) ----------
const cobroRows = readCsvAsObjects(path.join(SRC, "COBRO DE TRANSPORTE--TRANSP_.csv"));
const tarifaActualPorPdv: Record<string, number> = {};
for (const row of cobroRows) {
  const nombre = norm(row["PDV ACT"] ?? "");
  if (!nombre) continue;
  const valor = parseFloat((row["VALOR TRANSPORTE X ENTREGA FIJO"] ?? "0").replace(",", "."));
  if (!isNaN(valor)) tarifaActualPorPdv[nombre] = valor;
}

// ---------- 4. Unir PDV + ruta, construir maestro final ----------
const pdvMaster: Pdv[] = [];
for (const p of pdvsRaw) {
  if (p.lat === null || p.lon === null) {
    qualityReport.pdvEnRutasSinCoordenada.push(p.id);
    continue; // sin coordenada no se puede rutear; queda fuera del maestro pero reportado
  }
  const rutaInfo = rutaPorPdv.get(p.id);
  if (!rutaInfo) qualityReport.pdvSinRutaAsignada.push(p.id);

  pdvMaster.push({
    id: p.id,
    nombre: p.id,
    sector: p.sector,
    direccion: p.direccion,
    provincia: rutaInfo?.provincia || provinciaPorPrefijo.get(p.id.split(" ")[0]) || p.provincia,
    zona: p.zona,
    rutaActual: rutaInfo?.ruta ?? "SIN_RUTA",
    lat: p.lat,
    lon: p.lon,
    coordenadaValidada: p.coordenadaValidada,
    frecuenciaHelado: rutaInfo?.frecuenciaHelado ?? "",
    frecuenciaQuesoCrema: rutaInfo?.frecuenciaQuesoCrema ?? "",
    estatus: p.estatus as any,
  });
}

// ---------- 5. Rutas actuales: PDV agrupados por código de ruta + distancia estimada ----------
const rutasActuales: Record<string, { provincia: string; pdvIds: string[]; distanciaEstimadaKm: number }> = {};
const porRutaCodigo = new Map<string, Pdv[]>();
for (const p of pdvMaster) {
  if (!porRutaCodigo.has(p.rutaActual)) porRutaCodigo.set(p.rutaActual, []);
  porRutaCodigo.get(p.rutaActual)!.push(p);
}
for (const [ruta, pdvs] of porRutaCodigo.entries()) {
  const puntos = [DEPOT, ...pdvs.map((p) => ({ lat: p.lat, lon: p.lon }))];
  const km = puntos.map((a) => puntos.map((b) => haversineKm(a, b) * 1.3));
  const { distanciaTotalKm } = solveRouteOrder(0, km);
  rutasActuales[ruta] = {
    provincia: pdvs[0]?.provincia ?? "",
    pdvIds: pdvs.map((p) => p.id),
    distanciaEstimadaKm: Math.round(distanciaTotalKm * 10) / 10,
  };
}

// ---------- 6. Histórico de costos (TRANSPORTE CONTROL DE FACTURAS) ----------
const factRows = readCsvAsObjects(
  path.join(SRC, "TRANSPORTE CONTROL DE FACTURAS--TRANSPORTE.csv")
);
const hoja1Rows = readCsvAsObjects(path.join(SRC, "TRANSPORTE CONTROL DE FACTURAS--Hoja1.csv"));

const costoReferenciaPorRuta: Record<string, number> = {};
for (const row of hoja1Rows) {
  const ruta = row["Ruta"]?.trim();
  if (!ruta) continue;
  const costo = parseFloat((row["COSTO DE RUTA"] ?? "0").replace(/[^0-9.,-]/g, "").replace(",", "."));
  if (!isNaN(costo)) costoReferenciaPorRuta[ruta.toUpperCase()] = costo;
}

// distancia estimada por nombre de ruta "estilo FACT" (QUITO, GUAYAS, CUENCA, ...):
// se calcula a partir de rutasActuales (que están indexadas por el código original,
// ej. "CUE") usando el alias inverso código -> nombre FACT.
const aliasInverso = new Map<string, string>(); // "CUENCA" -> "CUE"
for (const codigo of Object.keys(rutasActuales)) {
  aliasInverso.set(nombreFactParaCodigo(codigo), codigo);
}
function distanciaEstimadaParaRutaFact(nombreFact: string): number | null {
  const codigo = aliasInverso.get(nombreFact.toUpperCase());
  if (!codigo) return null;
  return rutasActuales[codigo]?.distanciaEstimadaKm ?? null;
}

const muestras: { ruta: string; kg: number; costo: number; distKm: number }[] = [];
const agregadoPorRuta = new Map<string, { kgs: number[]; costos: number[] }>();

for (const row of factRows) {
  const rutaRaw = row["Ruta"]?.trim();
  if (!rutaRaw) continue;
  const ruta = rutaRaw.toUpperCase();
  const kg = parseFloat((row["kg Transportados helados"] ?? "0").replace(",", "."));
  const costo = parseFloat((row["Costo del viaje"] ?? "0").replace(/[^0-9.,-]/g, "").replace(",", "."));
  if (isNaN(kg) || isNaN(costo) || kg <= 0 || costo <= 0) continue;

  if (!agregadoPorRuta.has(ruta)) agregadoPorRuta.set(ruta, { kgs: [], costos: [] });
  agregadoPorRuta.get(ruta)!.kgs.push(kg);
  agregadoPorRuta.get(ruta)!.costos.push(costo);

  const distKm = distanciaEstimadaParaRutaFact(ruta);
  if (distKm === null) {
    if (!qualityReport.rutasNoReconocidasEnHistorico.includes(ruta)) {
      qualityReport.rutasNoReconocidasEnHistorico.push(ruta);
    }
    continue;
  }
  muestras.push({ ruta, kg, costo, distKm });
}

const historicoPorRuta: Record<string, { avgKg: number; avgCosto: number; numViajes: number; costoReferencia: number | null }> = {};
for (const [ruta, { kgs, costos }] of agregadoPorRuta.entries()) {
  historicoPorRuta[ruta] = {
    avgKg: Math.round((kgs.reduce((a, b) => a + b, 0) / kgs.length) * 10) / 10,
    avgCosto: Math.round((costos.reduce((a, b) => a + b, 0) / costos.length) * 100) / 100,
    numViajes: kgs.length,
    costoReferencia: costoReferenciaPorRuta[ruta] ?? null,
  };
}

// ---------- 7. Calibración de alpha/beta/gamma por regresión ----------
let costoFormula = { alpha: 50, beta: 0.05, gamma: 0.6 }; // valores de respaldo razonables (USD)
let r2 = 0;
if (muestras.length >= 8) {
  const reg = regresionLineal({
    y: muestras.map((m) => m.costo),
    x1: muestras.map((m) => m.kg),
    x2: muestras.map((m) => m.distKm),
  });
  r2 = reg.r2;
  costoFormula = {
    alpha: Math.max(0, Math.round(reg.alpha * 100) / 100),
    beta: Math.max(0, Math.round(reg.beta * 1000) / 1000),
    gamma: Math.max(0, Math.round(reg.gamma * 1000) / 1000),
  };
}

// ---------- 8. Escribir salidas ----------
fs.writeFileSync(path.join(OUT, "pdv-master.json"), JSON.stringify(pdvMaster, null, 2));
fs.writeFileSync(path.join(OUT, "rutas-actuales.json"), JSON.stringify(rutasActuales, null, 2));
fs.writeFileSync(path.join(OUT, "cobro-actual.json"), JSON.stringify(tarifaActualPorPdv, null, 2));
fs.writeFileSync(
  path.join(OUT, "costos-historicos.json"),
  JSON.stringify(
    {
      porRuta: historicoPorRuta,
      regresion: { ...costoFormula, r2: Math.round(r2 * 1000) / 1000, muestras: muestras.length },
    },
    null,
    2
  )
);

const configDefault: ConfigOptimizacion & { depot: { lat: number; lon: number } } = {
  capacidadCamionKg: 3500,
  // Flota real: 5 camiones tercerizados disponibles por semana (confirmado por el equipo).
  numeroCamionesDisponibles: 5,
  // Jornada semanal razonable por camión: ~5.5 días x 10h, dejando margen para carga/descarga.
  horasDisponiblesPorCamionSemana: 55,
  // Radio de trabajo por viaje: prioriza que cada camión cubra una zona compacta por
  // sobre llenarlo al 100% de capacidad a cualquier costo. Se probó contra el pedido real:
  // con 150km algún PDV aislado se quedaba sin vecinos disponibles y salía en un viaje
  // dedicado casi vacío; 220km da buena utilización sin mezclar regiones opuestas del país.
  radioMaximoViajeKm: 220,
  // Ventanas horarias (confirmado por el equipo): los PDV sin ventana especial reciben
  // desde las 6am; los camiones cargan en planta entre la 1am y las 4pm, y la carga toma
  // en promedio 1h30. Ver data/ventanas-horarias.json para las excepciones por PDV
  // (Paseo Shopping hasta las 9am, Mall de los Andes hasta las 10am).
  horaAperturaGeneral: "06:00",
  horaMasTempranoCarga: "01:00",
  horaMasTardeCarga: "16:00",
  duracionCargaMin: 90,
  factorCircuidadVial: 1.3,
  velocidadPromedioKmh: 45,
  minutosPorParada: 15,
  costoFormula,
  pesoAsignacionPct: 0.5,
  depot: DEPOT,
  // Cantidad mínima por producto para el "pago mínimo" del transportista (tabla de costos
  // logísticos de aperturas): 15 tachos de 12L de helado, 12 unidades de 1kg de queso, 10L
  // de crema de leche. Ver data/fletes-referenciales-aperturas.json y costModel.ts.
  minimosCarga: {
    heladoTachos: 15,
    litrosPorTachoHelado: 12,
    quesoUnidades: 12,
    kgPorUnidadQueso: 1,
    cremaLitros: 10,
  },
};
fs.writeFileSync(path.join(OUT, "config-default.json"), JSON.stringify(configDefault, null, 2));

if (!fs.existsSync(path.join(OUT, "productos-conversion.json"))) {
  fs.writeFileSync(path.join(OUT, "productos-conversion.json"), JSON.stringify([], null, 2));
}

fs.writeFileSync(path.join(OUT, "data-quality-report.json"), JSON.stringify(qualityReport, null, 2));

console.log(`PDV maestro: ${pdvMaster.length} (de ${matrizRows.length} filas en MATRIZ)`);
console.log(`Rutas activas: ${Object.keys(rutasActuales).length}`);
console.log(`Muestras usadas para calibrar costos: ${muestras.length} (R² = ${r2.toFixed(3)})`);
console.log(`Formula costo: alpha=${costoFormula.alpha} beta=${costoFormula.beta} gamma=${costoFormula.gamma}`);
console.log(`Coordenadas no parseables: ${qualityReport.coordenadasNoParseables.length}`);
console.log(`Coordenadas corregidas por signo: ${qualityReport.coordenadasCorregidasPorSigno.length}`);
console.log(`PDV sin ruta asignada en RUTAS DE TRANSPORTE 2026: ${qualityReport.pdvSinRutaAsignada.length}`);
console.log(`Rutas del histórico no reconocidas: ${qualityReport.rutasNoReconocidasEnHistorico.length}`);
