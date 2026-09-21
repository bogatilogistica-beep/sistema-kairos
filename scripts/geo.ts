export interface ParsedCoord {
  lat: number;
  lon: number;
  metodo: "directo" | "recuperado_extra_token" | "dms" | "signo_corregido";
}

const ECUADOR_BOUNDS = { latMin: -5.5, latMax: 2.0, lonMin: -81.5, lonMax: -74.0 };

function enRango(lat: number, lon: number): boolean {
  return (
    lat >= ECUADOR_BOUNDS.latMin &&
    lat <= ECUADOR_BOUNDS.latMax &&
    lon >= ECUADOR_BOUNDS.lonMin &&
    lon <= ECUADOR_BOUNDS.lonMax
  );
}

function limpiarToken(t: string): string {
  return t.replace(/\s+/g, "").replace(",", ".");
}

function esFlotanteValido(t: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(t) && (t.match(/\./g) || []).length <= 1;
}

function tryDms(raw: string): ParsedCoord | null {
  const m = raw.match(
    /(\d+)[°:]\s*(\d+)['′:]\s*([\d.]+)["″]?\s*([NnSs])[,;\s]+(\d+)[°:]\s*(\d+)['′:]\s*([\d.]+)["″]?\s*([EeWw])/
  );
  if (!m) return null;
  const [, dLat, mLat, sLat, hemLat, dLon, mLon, sLon, hemLon] = m;
  let lat = Number(dLat) + Number(mLat) / 60 + Number(sLat) / 3600;
  let lon = Number(dLon) + Number(mLon) / 60 + Number(sLon) / 3600;
  if (hemLat.toUpperCase() === "S") lat = -lat;
  if (hemLon.toUpperCase() === "W") lon = -lon;
  if (!enRango(lat, lon)) return null;
  return { lat, lon, metodo: "dms" };
}

/**
 * Parsea el campo "UBICACIÓN MAPS" de la matriz de ubicaciones, que viene con formatos
 * inconsistentes (copiado y pegado a mano desde Google Maps durante meses/años):
 *  - "lat,lon" con punto decimal (caso normal)
 *  - "lat, lon" con coma decimal europea + coma separadora (ej. "0,93, -78,61")
 *  - con un tercer/cuarto valor sobrante (nivel de zoom pegado por error, ej. ",21")
 *  - en formato grados/minutos/segundos (DMS)
 *  - corrupto/no recuperable (se retorna null)
 */
export function parseCoordString(raw: string): ParsedCoord | null {
  const s = raw.trim();
  if (!s) return null;

  const dms = tryDms(s);
  if (dms) return dms;

  // Caso "lat,lon" o "lat, lon" con coma decimal: separador real de par es la coma
  // seguida de espacio y luego signo/dígito.
  const pairSplit = s.split(/,\s+(?=-?\s*\d)/);
  if (pairSplit.length === 2) {
    const a = limpiarToken(pairSplit[0]);
    const b = limpiarToken(pairSplit[1]);
    if (esFlotanteValido(a) && esFlotanteValido(b)) {
      const lat = parseFloat(a);
      const lon = parseFloat(b);
      if (enRango(lat, lon)) return { lat, lon, metodo: "directo" };
    }
  }

  // Split simple por coma
  const parts = s.split(",").map((p) => p.trim());
  if (parts.length === 2) {
    const a = limpiarToken(parts[0]);
    const b = limpiarToken(parts[1]);
    if (esFlotanteValido(a) && esFlotanteValido(b)) {
      const lat = parseFloat(a);
      const lon = parseFloat(b);
      if (enRango(lat, lon)) return { lat, lon, metodo: "directo" };
    }
  }

  // Más de 2 partes: probablemente un valor extra (zoom, precisión) al final.
  if (parts.length > 2) {
    const a = parts[0].replace(/\s+/g, "");
    const b = parts[1].replace(/\s+/g, "");
    if (esFlotanteValido(a) && esFlotanteValido(b)) {
      const lat = parseFloat(a);
      const lon = parseFloat(b);
      if (enRango(lat, lon)) return { lat, lon, metodo: "recuperado_extra_token" };
    }
  }

  return null;
}

function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Detección de outliers geográficos usando la propia mediana provincial calculada del
 * dataset (sin depender de límites geográficos externos): si un punto parseado cae muy
 * lejos de la mediana de su provincia, se marca como sospechoso. Si invertir el signo de
 * lat y/o lon lo acerca mucho a esa mediana, se corrige automáticamente (error típico de
 * tipeo manual) y se deja marcado para verificación humana igual.
 */
export function detectarYCorregirOutliers<T extends { lat: number; lon: number; provincia: string }>(
  puntos: T[]
): { corregidos: T[]; sospechosos: string[] } {
  const porProvincia = new Map<string, { lat: number; lon: number }[]>();
  for (const p of puntos) {
    if (!porProvincia.has(p.provincia)) porProvincia.set(p.provincia, []);
    porProvincia.get(p.provincia)!.push(p);
  }

  const medianas = new Map<string, { lat: number; lon: number }>();
  for (const [prov, pts] of porProvincia.entries()) {
    const lats = pts.map((p) => p.lat).sort((a, b) => a - b);
    const lons = pts.map((p) => p.lon).sort((a, b) => a - b);
    const mid = Math.floor(lats.length / 2);
    medianas.set(prov, { lat: lats[mid], lon: lons[mid] });
  }

  const sospechosos: string[] = [];
  const corregidos = puntos.map((p) => {
    const mediana = medianas.get(p.provincia);
    if (!mediana) return p;
    const dist = haversine(p, mediana);
    if (dist <= 150) return p; // dentro de un radio razonable para provincias grandes (ej. Guayas)

    // Probar corrección de signo
    const candidatos = [
      { lat: -p.lat, lon: p.lon },
      { lat: p.lat, lon: -p.lon },
      { lat: -p.lat, lon: -p.lon },
    ];
    for (const c of candidatos) {
      if (haversine(c, mediana) <= 30) {
        sospechosos.push((p as any).id ?? JSON.stringify(p));
        return { ...p, lat: c.lat, lon: c.lon };
      }
    }
    sospechosos.push((p as any).id ?? JSON.stringify(p));
    return p;
  });

  return { corregidos, sospechosos };
}
