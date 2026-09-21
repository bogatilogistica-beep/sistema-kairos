import { Cluster } from "./clustering";
import { precioPactadoUsd } from "./costModel";
import { DEPOT_ID, distanciaCacheadaKm } from "./distanceCache";
import { haversineKm } from "./distance";
import { ConfigOptimizacion } from "./types";

/**
 * Consolidación de despachos flacos.
 *
 * POR QUÉ
 * -------
 * El transportista cobra precio fijo por ruta despachada. Un despacho que sale al 9% de
 * capacidad cuesta lo mismo que uno lleno: en el pedido real del 13-sep, IMBABURA salió con
 * 323 kg y costó $325 — $1.01 por kilo, contra $0.23 por kilo de la ruta GUAYAS. La
 * ineficiencia no está en los kilómetros recorridos, está en los camiones medio vacíos.
 *
 * Este paso busca pares de rutas que (a) quepan juntas en un camión, (b) estén lo bastante
 * cerca como para hacerse en un mismo viaje y (c) cuesten menos fusionadas que por separado.
 * Es exactamente lo que el equipo de logística ya hace a ojo cuando ve dos rutas flacas;
 * aquí queda medido y repetible.
 *
 * SUPUESTO QUE HAY QUE CONFIRMAR CON EL TRANSPORTISTA
 * --------------------------------------------------
 * El precio de una ruta combinada sale de `factorRutaCombinada` (0.87 por defecto), estimado
 * con los DOS únicos casos combinados del histórico: CUENCA-LOJA cobró $900 sobre $1.090
 * sumados, y GUAYAS-PLAYAS $780 sobre $850. Con dos muestras es una aproximación, no un
 * precio pactado. Si el transportista cobra distinto, este número cambia el resultado: hay
 * que pedirle tarifa para las combinaciones que el sistema proponga antes de comprometerlas.
 */

export interface OpcionConsolidacion {
  rutaA: string;
  rutaB: string;
  pesoTotalKg: number;
  llenadoPct: number;
  separacionKm: number;
  costoSeparadoUsd: number;
  costoFusionadoUsd: number;
  ahorroUsd: number;
}

export interface ResultadoConsolidacion {
  clusters: Cluster[];
  fusiones: OpcionConsolidacion[];
  ahorroTotalUsd: number;
  /** Despachos que no alcanzan a repartir dentro de la jornada, fusionados o no. */
  fueraDeJornada: { id: string; finEntregas: string; paradas: number }[];
}

/**
 * Hora (en minutos desde medianoche) a la que terminaría la ÚLTIMA entrega del viaje.
 *
 * El helado no aguanta pernoctar en el camión: todas las entregas de un despacho tienen que
 * completarse el mismo día y antes de la hora tope. Por eso una fusión no se evalúa solo por
 * capacidad y precio — si el viaje combinado no alcanza a repartir dentro de la jornada, no
 * sirve por barato que salga.
 *
 * El recorrido se estima con vecino más cercano desde el depósito (la secuencia definitiva la
 * calcula después solveRouteOrder, que solo puede mejorarla): sirve como cota realista para
 * decidir si la fusión es viable.
 */
function finDeEntregasMin(
  c: Cluster,
  config: ConfigOptimizacion & { depot?: { lat: number; lon: number } }
): number {
  const salida = minutosDeHora(config.horaMasTempranoCarga) + config.duracionCargaMin;
  const apertura = minutosDeHora(config.horaAperturaGeneral);

  const km = (a: string, b: string): number => {
    if (a === b) return 0;
    const real = distanciaCacheadaKm(a, b);
    if (real !== null) return real;
    const pa = puntoDe(c, a);
    const pb = puntoDe(c, b);
    if (!pa || !pb) return 0;
    return haversineKm(pa, pb) * config.factorCircuidadVial;
  };

  const pendientes = c.cargas.map((x) => x.pdv.id);
  let actual = DEPOT_ID;
  let reloj = salida;
  let primera = true;
  while (pendientes.length > 0) {
    let mejor = pendientes[0];
    let mejorKm = Infinity;
    for (const cand of pendientes) {
      const d = km(actual, cand);
      if (d < mejorKm) {
        mejorKm = d;
        mejor = cand;
      }
    }
    reloj += (mejorKm / config.velocidadPromedioKmh) * 60;
    if (primera) {
      reloj = Math.max(reloj, apertura); // el primer PDV no recibe antes de abrir
      primera = false;
    }
    // la hora de llegada es `reloj`; el tiempo de atención se suma para la siguiente parada
    if (pendientes.length === 1) return reloj;
    reloj += config.minutosPorParada;
    actual = mejor;
    pendientes.splice(pendientes.indexOf(mejor), 1);
  }
  return reloj;
}

function minutosDeHora(hhmm: string): number {
  const [h, m] = (hhmm || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function puntoDe(c: Cluster, id: string): { lat: number; lon: number } | null {
  const carga = c.cargas.find((x) => x.pdv.id === id);
  return carga ? { lat: carga.pdv.lat, lon: carga.pdv.lon } : null;
}

/** Distancia mínima entre cualquier PDV de A y cualquiera de B: mide si son vecinas de verdad. */
function separacionKm(a: Cluster, b: Cluster): number {
  let min = Infinity;
  for (const ca of a.cargas) {
    for (const cb of b.cargas) {
      const real = distanciaCacheadaKm(ca.pdv.id, cb.pdv.id);
      const d =
        real ??
        haversineKm({ lat: ca.pdv.lat, lon: ca.pdv.lon }, { lat: cb.pdv.lat, lon: cb.pdv.lon }) * 1.3;
      if (d < min) min = d;
    }
  }
  return min;
}

function rutasDe(c: Cluster): string[] {
  return [...new Set(c.cargas.map((x) => x.pdv.rutaActual).filter(Boolean))] as string[];
}

function costoDe(c: Cluster, config: ConfigOptimizacion): number {
  const pactado = precioPactadoUsd(rutasDe(c));
  if (pactado !== null) return pactado;
  return config.costoFormula.alpha + config.costoFormula.beta * c.pesoTotalKg;
}

/**
 * Fusiona pares de despachos mientras convenga, de forma voraz: en cada vuelta toma la
 * fusión que más ahorra y repite, así una ruta flaca puede terminar absorbiendo a dos
 * vecinas si el camión aguanta.
 */
export function consolidarDespachos(
  clusters: Cluster[],
  config: ConfigOptimizacion & {
    separacionMaximaKm?: number;
    llenadoObjetivoPct?: number;
    horaFinEntregas?: string;
  }
): ResultadoConsolidacion {
  const separacionMax = config.separacionMaximaKm ?? 180;
  // El helado no puede quedarse una noche en el camión: todas las entregas de un despacho
  // tienen que estar hechas antes de esta hora, el mismo día que sale.
  const topeEntregaMin = minutosDeHora(config.horaFinEntregas ?? "20:00");
  // solo se intenta fusionar despachos que van por debajo de este llenado: los que ya van
  // llenos no tienen nada que ganar y fusionarlos solo alargaría el viaje.
  const umbralLlenado = (config.llenadoObjetivoPct ?? 70) / 100;

  const actuales = clusters.map((c) => ({ ...c, cargas: [...c.cargas] }));
  const fusiones: OpcionConsolidacion[] = [];
  let ahorroTotal = 0;

  for (;;) {
    let mejor: { i: number; j: number; op: OpcionConsolidacion } | null = null;

    for (let i = 0; i < actuales.length; i++) {
      for (let j = i + 1; j < actuales.length; j++) {
        const a = actuales[i];
        const b = actuales[j];
        const peso = a.pesoTotalKg + b.pesoTotalKg;
        if (peso > config.capacidadCamionKg) continue;
        if (
          a.pesoTotalKg / config.capacidadCamionKg >= umbralLlenado &&
          b.pesoTotalKg / config.capacidadCamionKg >= umbralLlenado
        )
          continue; // ambos ya van razonablemente llenos

        const sep = separacionKm(a, b);
        if (sep > separacionMax) continue; // no son vecinas: fusionarlas sería cruzar el país

        const costoSeparado = costoDe(a, config) + costoDe(b, config);
        const fusionado: Cluster = {
          id: `${a.id} + ${b.id}`,
          cargas: [...a.cargas, ...b.cargas],
          pesoTotalKg: peso,
        };
        const costoFusionado = costoDe(fusionado, config);
        const ahorro = costoSeparado - costoFusionado;
        if (ahorro <= 0.01) continue;

        // El producto no puede pernoctar en el camión: si el viaje combinado no termina de
        // repartir dentro de la jornada, la fusión se descarta aunque salga más barata.
        const fin = finDeEntregasMin(fusionado, config);
        if (fin > topeEntregaMin) continue;

        const op: OpcionConsolidacion = {
          rutaA: a.id,
          rutaB: b.id,
          pesoTotalKg: Math.round(peso * 10) / 10,
          llenadoPct: Math.round((peso / config.capacidadCamionKg) * 1000) / 10,
          separacionKm: Math.round(sep),
          costoSeparadoUsd: Math.round(costoSeparado * 100) / 100,
          costoFusionadoUsd: Math.round(costoFusionado * 100) / 100,
          ahorroUsd: Math.round(ahorro * 100) / 100,
        };
        if (!mejor || op.ahorroUsd > mejor.op.ahorroUsd) mejor = { i, j, op };
      }
    }

    if (!mejor) break;

    const a = actuales[mejor.i];
    const b = actuales[mejor.j];
    actuales.splice(mejor.j, 1); // j > i, se quita primero para no correr el índice i
    actuales[mejor.i] = {
      id: `${a.id} + ${b.id}`,
      cargas: [...a.cargas, ...b.cargas],
      pesoTotalKg: Math.round((a.pesoTotalKg + b.pesoTotalKg) * 100) / 100,
    };
    fusiones.push(mejor.op);
    ahorroTotal += mejor.op.ahorroUsd;
  }

  const fh = (m: number) =>
    m < 1440
      ? `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`
      : `+${String(Math.floor((m - 1440) / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;

  // Aviso, no bloqueo: si una ruta base ya no cabe en la jornada, el problema es de la ruta
  // misma (demasiados km desde Ambato), no de la consolidación. Hay que verlo con operaciones.
  const fueraDeJornada = actuales
    .map((c) => ({ c, fin: finDeEntregasMin(c, config) }))
    .filter((x) => x.fin > topeEntregaMin)
    .map((x) => ({ id: x.c.id, finEntregas: fh(x.fin), paradas: x.c.cargas.length }));

  return {
    clusters: actuales,
    fusiones,
    ahorroTotalUsd: Math.round(ahorroTotal * 100) / 100,
    fueraDeJornada,
  };
}
