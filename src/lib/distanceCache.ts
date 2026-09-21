import cacheJson from "../../data/distancias-cache.json";
import type { LatLon } from "./distance";

interface EntradaCache {
  km: number;
  min: number;
}

const CACHE: Record<string, EntradaCache> = cacheJson as any;

export const DEPOT_ID = "__DEPOSITO__";

function claveCache(idA: string, idB: string): string {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

/** Distancia real precalculada entre dos PDV (o entre un PDV y el depósito), si existe en caché. */
export function distanciaCacheadaKm(idA: string, idB: string): number | null {
  if (idA === idB) return 0;
  return CACHE[claveCache(idA, idB)]?.km ?? null;
}

export function minutosCacheadosEntre(idA: string, idB: string): number | null {
  if (idA === idB) return 0;
  return CACHE[claveCache(idA, idB)]?.min ?? null;
}

export function tamanoCache(): number {
  return Object.keys(CACHE).length;
}

// Haversine local (duplicado deliberadamente de distance.ts): distanceCache.ts no debe
// depender en tiempo de ejecución de distance.ts, porque distance.ts importa de aquí para
// poder usar la caché en getDistanceMatrix — evita una dependencia circular entre módulos.
function haversineLocalKm(a: LatLon, b: LatLon): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Distancia entre dos PDV con caída en cascada: caché de distancia real precalculada
 * (Google/Mapbox, generada una sola vez con `npm run precalcular-distancias`) → Haversine +
 * factor vial si el par no está en caché (ej. un PDV nuevo agregado después de calcular la
 * caché). Se usa para decidir el agrupamiento por cercanía real, no solo para secuenciar
 * cada viaje ya armado.
 */
export function distanciaKmConCache(
  idA: string,
  puntoA: LatLon,
  idB: string,
  puntoB: LatLon,
  factorCircuidad: number
): number {
  const cacheada = distanciaCacheadaKm(idA, idB);
  if (cacheada !== null) return cacheada;
  return haversineLocalKm(puntoA, puntoB) * factorCircuidad;
}
