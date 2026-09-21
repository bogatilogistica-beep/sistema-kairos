/**
 * Precalcula la distancia real de carretera (Google Distance Matrix) entre TODOS los
 * pares del depósito + los PDV activos, y la guarda en data/distancias-cache.json.
 *
 * Se corre una sola vez (o cada vez que cambie el maestro de PDV): el resultado no
 * depende de qué pedido se cargue cada semana, así que en producción la plataforma nunca
 * necesita llamar a la API en vivo para decidir el agrupamiento por cercanía — solo lee
 * esta caché. Esto también significa que sigue funcionando aunque la API key temporal se
 * revoque después: la caché queda guardada en el repo.
 *
 * Uso: npm run precalcular-distancias
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
const API_KEY = env.GOOGLE_MAPS_API_KEY;
if (!API_KEY) {
  console.error("No se encontró GOOGLE_MAPS_API_KEY en .env.local ni en el entorno. Abortando.");
  process.exit(1);
}

interface Punto {
  id: string;
  lat: number;
  lon: number;
}

const puntos: Punto[] = [
  { id: DEPOT_ID, lat: (configDefault as any).depot.lat, lon: (configDefault as any).depot.lon },
  ...(pdvMaster as any[]).map((p) => ({ id: p.id, lat: p.lat, lon: p.lon })),
];

console.log(`Puntos a calcular: ${puntos.length} (${puntos.length - 1} PDV + depósito)`);

const cache: Record<string, { km: number; min: number }> = fs.existsSync(CACHE_PATH)
  ? JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"))
  : {};

function clave(idA: string, idB: string): string {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

function guardarCache() {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

async function pedirBloque(origenes: Punto[], destinos: Punto[]): Promise<void> {
  const coordsStr = (p: Punto) => `${p.lat},${p.lon}`;
  const url =
    `https://maps.googleapis.com/maps/api/distancematrix/json` +
    `?origins=${origenes.map(coordsStr).join("|")}` +
    `&destinations=${destinos.map(coordsStr).join("|")}` +
    `&mode=driving&key=${API_KEY}`;

  const res = await fetch(url);
  const json: any = await res.json();
  if (json.status !== "OK") {
    throw new Error(`Google Distance Matrix error: ${json.status} ${json.error_message ?? ""}`);
  }
  for (let i = 0; i < origenes.length; i++) {
    for (let j = 0; j < destinos.length; j++) {
      const a = origenes[i];
      const b = destinos[j];
      if (a.id === b.id) continue;
      const el = json.rows[i]?.elements?.[j];
      if (el?.status === "OK") {
        cache[clave(a.id, b.id)] = {
          km: Math.round((el.distance.value / 1000) * 100) / 100,
          min: Math.round((el.duration.value / 60) * 10) / 10,
        };
      }
    }
  }
}

async function main() {
  const CHUNK = 10;
  const n = puntos.length;
  const numChunks = Math.ceil(n / CHUNK);
  let llamadas = 0;
  let fallidas = 0;
  const inicio = Date.now();

  for (let oi = 0; oi < numChunks; oi++) {
    const origenes = puntos.slice(oi * CHUNK, oi * CHUNK + CHUNK);
    for (let di = oi; di < numChunks; di++) {
      const destinos = puntos.slice(di * CHUNK, di * CHUNK + CHUNK);
      llamadas++;
      try {
        await pedirBloque(origenes, destinos);
      } catch (err) {
        fallidas++;
        console.error(`  Bloque (${oi},${di}) falló:`, (err as Error).message);
        // reintento simple
        try {
          await new Promise((r) => setTimeout(r, 1000));
          await pedirBloque(origenes, destinos);
          fallidas--;
        } catch {
          /* se deja sin caché ese bloque; el runtime cae a Haversine para esos pares */
        }
      }
      if (llamadas % 10 === 0) {
        guardarCache();
        const pct = Math.round((llamadas / ((numChunks * (numChunks + 1)) / 2)) * 100);
        console.log(`  ${llamadas} llamadas hechas (${pct}%), ${Object.keys(cache).length} pares en caché…`);
      }
      await new Promise((r) => setTimeout(r, 120)); // ritmo suave para no saturar la cuota
    }
  }

  guardarCache();
  console.log(
    `Listo: ${llamadas} llamadas (${fallidas} fallidas tras reintento), ${Object.keys(cache).length} pares guardados en ${CACHE_PATH}`
  );
  console.log(`Tiempo total: ${Math.round((Date.now() - inicio) / 1000)}s`);
}

main();
