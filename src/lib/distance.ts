// Cálculo de distancias entre PDVs.
// Por defecto usa Haversine + factor de corrección vial (sin costo, sin API key).
// Si existe GOOGLE_MAPS_API_KEY o MAPBOX_TOKEN en las variables de entorno, se usa
// la matriz de distancias reales del proveedor correspondiente (llamado solo en el servidor).

import { distanciaCacheadaKm, minutosCacheadosEntre } from "./distanceCache";

export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: LatLon, b: LatLon): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  return EARTH_RADIUS_KM * c;
}

export type DistanceProvider = "haversine" | "google" | "mapbox" | "cache" | "osrm";

export function activeDistanceProvider(): DistanceProvider {
  // OSRM propio tiene prioridad sobre las APIs pagas: es gratis, sin límite de consultas,
  // y resuelve la matriz completa en una sola llamada (sin trocear de 10 en 10 como Google
  // ni toparse con el máximo de 25 puntos de Mapbox). Solo se activa si OSRM_URL existe,
  // así que sin esa variable la plataforma se comporta exactamente igual que antes.
  if (process.env.OSRM_URL) return "osrm";
  if (process.env.GOOGLE_MAPS_API_KEY) return "google";
  if (process.env.MAPBOX_TOKEN) return "mapbox";
  return "haversine";
}

/**
 * Distancia aproximada por carretera cuando no hay proveedor real: línea recta * factor de
 * circuidad vial. 1.3x es un valor típico usado en logística para vías interprovinciales de Ecuador
 * (terreno con curvas de sierra/costa); se puede ajustar en la configuración de la plataforma.
 */
export function estimateRoadKm(a: LatLon, b: LatLon, factorCircuidad: number): number {
  return haversineKm(a, b) * factorCircuidad;
}

export interface DistanceMatrixResult {
  provider: DistanceProvider;
  km: number[][]; // km[i][j] = distancia de points[i] a points[j]
  minutes: number[][];
}

async function googleDistanceMatrix(points: LatLon[]): Promise<DistanceMatrixResult> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY!;
  const n = points.length;
  const km: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const minutes: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  // Google Distance Matrix admite hasta 25 orígenes/destinos por llamada (625 elementos).
  const CHUNK = 10;
  const coordsStr = (p: LatLon) => `${p.lat},${p.lon}`;

  for (let oi = 0; oi < n; oi += CHUNK) {
    const origins = points.slice(oi, oi + CHUNK);
    for (let di = 0; di < n; di += CHUNK) {
      const destinations = points.slice(di, di + CHUNK);
      const url =
        `https://maps.googleapis.com/maps/api/distancematrix/json` +
        `?origins=${origins.map(coordsStr).join("|")}` +
        `&destinations=${destinations.map(coordsStr).join("|")}` +
        `&mode=driving&key=${apiKey}`;

      const res = await fetch(url);
      const json = await res.json();
      if (json.status !== "OK") {
        throw new Error(`Google Distance Matrix error: ${json.status} ${json.error_message ?? ""}`);
      }
      for (let i = 0; i < origins.length; i++) {
        for (let j = 0; j < destinations.length; j++) {
          const el = json.rows[i]?.elements?.[j];
          if (el?.status === "OK") {
            km[oi + i][di + j] = el.distance.value / 1000;
            minutes[oi + i][di + j] = el.duration.value / 60;
          } else {
            // fallback puntual si un par específico falla
            km[oi + i][di + j] = haversineKm(origins[i], destinations[j]) * 1.3;
            minutes[oi + i][di + j] = (km[oi + i][di + j] / 45) * 60;
          }
        }
      }
    }
  }
  return { provider: "google", km, minutes };
}

/**
 * OSRM autoalojado sobre el mapa vial de Ecuador (OpenStreetMap).
 * Devuelve distancia y duración reales de manejo. A diferencia de Google y Mapbox,
 * resuelve la matriz entera en una sola petición y no cobra por consulta.
 *
 * Requiere que osrm-routed corra con --max-table-size mayor al número de puntos;
 * con el valor por defecto (100) cualquier matriz más grande falla.
 */
async function osrmDistanceMatrix(points: LatLon[]): Promise<DistanceMatrixResult> {
  const base = process.env.OSRM_URL!.replace(/\/+$/, "");
  const coords = points.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
  const url = `${base}/table/v1/driving/${coords}?annotations=duration,distance`;

  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) {
    const body = await res.text();
    const pista = /too many|coordinates/i.test(body)
      ? ` — relanza osrm-routed con --max-table-size ${points.length + 50} o más`
      : "";
    throw new Error(`OSRM respondió ${res.status}: ${body.slice(0, 200)}${pista}`);
  }

  const json = await res.json();
  if (json.code !== "Ok") {
    throw new Error(`OSRM: ${json.code} ${json.message ?? ""}`);
  }

  const n = points.length;
  const km: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const minutes: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const metros = json.distances?.[i]?.[j];
      const segundos = json.durations?.[i]?.[j];
      if (metros == null || segundos == null) {
        // par sin ruta (isla, punto mal geocodificado): se estima en vez de romper la matriz
        km[i][j] = haversineKm(points[i], points[j]) * 1.3;
        minutes[i][j] = (km[i][j] / 45) * 60;
      } else {
        km[i][j] = metros / 1000;
        minutes[i][j] = segundos / 60;
      }
    }
  }
  return { provider: "osrm", km, minutes };
}

async function mapboxDistanceMatrix(points: LatLon[]): Promise<DistanceMatrixResult> {
  const token = process.env.MAPBOX_TOKEN!;
  const n = points.length;
  // Mapbox Matrix API (driving) admite hasta 25 coordenadas por llamada.
  if (n > 25) {
    throw new Error("Mapbox Matrix API: máximo 25 puntos por llamada. Reduce el tamaño del clúster o usa Google.");
  }
  const coords = points.map((p) => `${p.lon},${p.lat}`).join(";");
  const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coords}?annotations=distance,duration&access_token=${token}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.code !== "Ok") {
    throw new Error(`Mapbox Matrix error: ${json.code}`);
  }
  const km: number[][] = json.distances.map((row: number[]) => row.map((m) => m / 1000));
  const minutes: number[][] = json.durations.map((row: number[]) => row.map((s) => s / 60));
  return { provider: "mapbox", km, minutes };
}

/**
 * Devuelve la matriz de distancias/tiempos entre un conjunto de puntos, usando el mejor
 * proveedor disponible. Si se pasan `ids` (identificadores de PDV/depósito) y todos los
 * pares están en la caché precalculada (`npm run precalcular-distancias`), se usa esa
 * caché directamente sin llamar a ninguna API — así la plataforma sigue funcionando con
 * distancias reales aunque la API key se revoque, para cualquier PDV ya existente cuando
 * se generó la caché. Se usa por clúster/camión (no para los 158 PDV a la vez) para
 * mantenerse dentro de los límites de las APIs gratuitas/pagas.
 */
export async function getDistanceMatrix(
  points: LatLon[],
  factorCircuidad: number,
  velocidadPromedioKmh: number,
  ids?: string[]
): Promise<DistanceMatrixResult> {
  if (ids && ids.length === points.length) {
    const cacheado = intentarDesdeCache(points, ids, factorCircuidad, velocidadPromedioKmh);
    if (cacheado) return cacheado;
  }

  const provider = activeDistanceProvider();
  try {
    if (provider === "osrm") return await osrmDistanceMatrix(points);
    if (provider === "google") return await googleDistanceMatrix(points);
    if (provider === "mapbox") return await mapboxDistanceMatrix(points);
  } catch (err) {
    console.error(`Proveedor de distancias "${provider}" falló, usando Haversine como respaldo:`, err);
  }

  const n = points.length;
  const km: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const minutes: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      km[i][j] = estimateRoadKm(points[i], points[j], factorCircuidad);
      minutes[i][j] = (km[i][j] / velocidadPromedioKmh) * 60;
    }
  }
  return { provider: "haversine", km, minutes };
}

function intentarDesdeCache(
  points: LatLon[],
  ids: string[],
  factorCircuidad: number,
  velocidadPromedioKmh: number
): DistanceMatrixResult | null {
  const n = points.length;
  const km: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const minutes: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const kmCacheado = distanciaCacheadaKm(ids[i], ids[j]);
      if (kmCacheado === null) return null; // falta algún par: no se usa caché parcial, se sigue con la API/Haversine
      km[i][j] = kmCacheado;
      const minCacheado = minutosCacheadosEntre(ids[i], ids[j]);
      minutes[i][j] = minCacheado ?? (kmCacheado / velocidadPromedioKmh) * 60;
    }
  }
  return { provider: "cache", km, minutes };
}
