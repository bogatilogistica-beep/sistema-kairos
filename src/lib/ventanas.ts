import { twoOpt } from "./tsp";

export function minutosDesdeMedianoche(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

export function formatoHora(minutos: number): string {
  const m = ((Math.round(minutos) % 1440) + 1440) % 1440; // envuelve si cruza medianoche
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * Reordena una ruta ya armada (salida de solveRouteOrder) para que las paradas con
 * ventana horaria (ej. Paseo Shopping antes de las 9am) se visiten primero, en orden de
 * hora límite más temprana a más tardía. El resto de paradas mantiene su secuencia
 * optimizada por distancia, re-encadenada con 2-opt a partir de la última parada con
 * ventana (o del depósito si no hay ninguna).
 */
export function reordenarPorVentanas(order: number[], km: number[][], deadlinePorIndice: Map<number, number>): number[] {
  if (deadlinePorIndice.size === 0) return order;

  const depotIdx = order[0];
  const medio = order.slice(1, -1);
  const conVentana = medio
    .filter((i) => deadlinePorIndice.has(i))
    .sort((a, b) => deadlinePorIndice.get(a)! - deadlinePorIndice.get(b)!);
  const sinVentana = medio.filter((i) => !deadlinePorIndice.has(i));

  if (sinVentana.length === 0) return [depotIdx, ...conVentana, depotIdx];

  const puntoPartida = conVentana.length > 0 ? conVentana[conVentana.length - 1] : depotIdx;
  const restoOptimizado = twoOpt([puntoPartida, ...sinVentana], km).slice(1);

  return [depotIdx, ...conVentana, ...restoOptimizado, depotIdx];
}

export function distanciaDeOrden(order: number[], km: number[][]): number {
  let total = 0;
  for (let i = 0; i < order.length - 1; i++) total += km[order[i]][order[i + 1]];
  return total;
}

export interface ResultadoHorarios {
  horaSalidaMin: number;
  llegadas: number[]; // una por parada intermedia (sin depósito), en minutos desde medianoche
  alerta: string | null;
}

/**
 * Calcula la hora de salida del camión y la hora estimada de llegada a cada parada.
 *  - Si hay paradas con ventana horaria, la hora de salida se calcula hacia atrás desde
 *    la ventana más exigente (deadline - tiempo de viaje/servicio acumulado hasta ahí).
 *  - Nunca antes de `pisoSalidaMin` (lo más temprano que un camión puede salir de planta:
 *    hora más temprana de carga + duración de carga). Si la ventana exige salir antes del
 *    piso, no alcanza — se marca alerta y el camión sale lo más temprano posible igual.
 *  - Si no hay ninguna ventana, se usa `horaAperturaGeneralMin` como salida de referencia.
 */
export function calcularHorarios(
  order: number[],
  minutes: number[][],
  minutosServicioPorParada: number,
  deadlinePorIndice: Map<number, number>,
  horaAperturaGeneralMin: number,
  pisoSalidaMin: number
): ResultadoHorarios {
  let horaSalidaMin: number;
  let alerta: string | null = null;

  if (deadlinePorIndice.size > 0) {
    let acumulado = 0;
    let salidaRequerida = Infinity;
    for (let i = 1; i < order.length; i++) {
      acumulado += minutes[order[i - 1]][order[i]];
      if (deadlinePorIndice.has(order[i])) {
        const requerida = deadlinePorIndice.get(order[i])! - acumulado;
        salidaRequerida = Math.min(salidaRequerida, requerida);
      }
      acumulado += minutosServicioPorParada;
    }
    horaSalidaMin = Math.max(pisoSalidaMin, salidaRequerida);
    if (salidaRequerida < pisoSalidaMin) {
      alerta = `El camión debería salir a las ${formatoHora(salidaRequerida)} para cumplir la ventana horaria más exigente, pero no puede salir antes de ${formatoHora(pisoSalidaMin)} (planta abre para cargar desde esa hora).`;
    }
  } else {
    horaSalidaMin = Math.max(pisoSalidaMin, horaAperturaGeneralMin);
  }

  let t = horaSalidaMin;
  const llegadas: number[] = [];
  for (let i = 1; i < order.length; i++) {
    t += minutes[order[i - 1]][order[i]];
    llegadas.push(t);
    if (deadlinePorIndice.has(order[i]) && t > deadlinePorIndice.get(order[i])! && !alerta) {
      alerta = `Llega a las ${formatoHora(t)}, después de la hora límite de ${formatoHora(deadlinePorIndice.get(order[i])!)}.`;
    }
    t += minutosServicioPorParada;
  }

  return { horaSalidaMin, llegadas, alerta };
}
