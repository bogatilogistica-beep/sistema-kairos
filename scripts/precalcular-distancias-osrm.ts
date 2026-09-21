/**
 * Igual que precalcular-distancias.ts, pero usando OSRM autoalojado en vez de Google.
 *
 * Diferencia práctica: Google obliga a trocear la matriz de 10 en 10 (unas 136 peticiones
 * facturadas para los 157 PDV). OSRM resuelve los 158x158 = 24.964 pares en UNA sola
 * petición, gratis y en menos de un segundo.
 *
 * El archivo de salida es el mismo (data/distancias-cache.json) y con el mismo formato,
 * así que el resto de la plataforma no cambia en nada.
 *
 * Requiere OSRM_URL en .env.local y que osrm-routed corra con --max-table-size 1000.
 *
 * Uso: npm run precalcular-distancias-osrm
 */
import fs from "node:fs";
import path from "node:path";
import pdvMaster from "../data/pdv-master.json";
import configDefault from "../data/config-default.json";

const ROOT = path.resolve(__dirname, "..");
const CACHE_PATH = path.join(ROOT, "data", "distancias-cache.json");
const DEPOT_ID = "__DEPOSITO__";

function leerEnvLocal(): Record<string, string> {
  const envPath = path.join(ROOT, ".env.local");
  const vars: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return vars;
  for (const linea of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = linea.match(/^([A-Z_]+)=(.*)$/);
    if (m) vars[m[1]] = m[2].trim();
  }
  return vars;
}

const env = { ...leerEnvLocal(), ...process.env };
const OSRM = (env.OSRM_URL ?? "").replace(/\/+$/, "");
if (!OSRM) {
  console.error("No se encontró OSRM_URL en .env.local ni en el entorno. Abortando.");
  console.error("Ejemplo:  OSRM_URL=http://localhost:5000");
  process.exit(1);
}

interface Punto {
  id: string;
  lat: number;
  lon: number;
}

const puntos: Punto[] = [
  { id: DEPOT_ID, lat: (configDefault as any).depot.lat, lon: (configDefault as any).depot.lon },
  ...(pdvMaster as any[])
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .map((p) => ({ id: p.id, lat: p.lat, lon: p.lon })),
];

function clave(idA: string, idB: string): string {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

function haversineKm(a: Punto, b: Punto): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

async function main() {
  const n = puntos.length;
  console.log(`Puntos: ${n} (${n - 1} PDV + depósito) -> ${n * n} pares`);
  console.log(`OSRM: ${OSRM}`);

  const coords = puntos.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
  const url = `${OSRM}/table/v1/driving/${coords}?annotations=duration,distance`;

  const t0 = Date.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) {
    const body = await res.text();
    console.error(`OSRM respondió ${res.status}: ${body.slice(0, 300)}`);
    if (/too many|coordinates/i.test(body)) {
      console.error(`-> Relanza osrm-routed con --max-table-size ${n + 50} o más.`);
    }
    process.exit(1);
  }
  const json: any = await res.json();
  if (json.code !== "Ok") {
    console.error(`OSRM: ${json.code} ${json.message ?? ""}`);
    process.exit(1);
  }
  console.log(`Matriz recibida en ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const cache: Record<string, { km: number; min: number }> = {};
  let estimados = 0;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const metros = json.distances?.[i]?.[j];
      const segundos = json.durations?.[i]?.[j];
      let km: number;
      let min: number;
      if (metros == null || segundos == null) {
        // par sin ruta: se estima para no dejar huecos que invaliden la caché completa
        km = haversineKm(puntos[i], puntos[j]) * 1.3;
        min = (km / 45) * 60;
        estimados++;
      } else {
        km = metros / 1000;
        min = segundos / 60;
      }
      cache[clave(puntos[i].id, puntos[j].id)] = {
        km: Math.round(km * 100) / 100,
        min: Math.round(min * 10) / 10,
      };
    }
  }

  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  const kms = Object.values(cache).map((v) => v.km);
  console.log(`\nGuardado: ${Object.keys(cache).length} pares en ${path.relative(ROOT, CACHE_PATH)}`);
  console.log(`  distancia mín/media/máx: ${Math.min(...kms).toFixed(1)} / ${(kms.reduce((a, b) => a + b, 0) / kms.length).toFixed(1)} / ${Math.max(...kms).toFixed(1)} km`);
  if (estimados) console.log(`  ${estimados} pares sin ruta en OSRM (estimados con Haversine x1.3)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
