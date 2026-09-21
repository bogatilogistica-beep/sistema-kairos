// Heurística de secuenciación de ruta (TSP aproximado): recorrido del árbol de expansión
// mínima del grafo de distancias + mejora 2-opt. Suficiente para clústeres pequeños (una
// carga de camión, típicamente 5-15 PDV).

import { construirGrafo, arbolExpansionMinima, ordenPorMst } from "./grafo";

export function nearestNeighborOrder(depotIndex: number, km: number[][]): number[] {
  const n = km.length;
  const visited = new Array(n).fill(false);
  const order: number[] = [depotIndex];
  visited[depotIndex] = true;

  let current = depotIndex;
  for (let step = 1; step < n; step++) {
    let best = -1;
    let bestDist = Infinity;
    for (let j = 0; j < n; j++) {
      if (!visited[j] && km[current][j] < bestDist) {
        bestDist = km[current][j];
        best = j;
      }
    }
    order.push(best);
    visited[best] = true;
    current = best;
  }
  return order;
}

function routeLength(order: number[], km: number[][]): number {
  let total = 0;
  for (let i = 0; i < order.length - 1; i++) {
    total += km[order[i]][order[i + 1]];
  }
  return total;
}

/** Mejora 2-opt clásica: revierte segmentos mientras reduzcan la distancia total. */
export function twoOpt(order: number[], km: number[][], maxIterations = 200): number[] {
  let best = [...order];
  let improved = true;
  let iterations = 0;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;
    for (let i = 1; i < best.length - 2; i++) {
      for (let j = i + 1; j < best.length - 1; j++) {
        const a = best[i - 1];
        const b = best[i];
        const c = best[j];
        const d = best[j + 1];
        const delta = km[a][c] + km[b][d] - (km[a][b] + km[c][d]);
        if (delta < -1e-6) {
          const reversed = best.slice(i, j + 1).reverse();
          best = [...best.slice(0, i), ...reversed, ...best.slice(j + 1)];
          improved = true;
        }
      }
    }
  }
  return best;
}

/**
 * Ordena las paradas de una ruta partiendo y volviendo al depósito, usando teoría de
 * grafos: construye el árbol de expansión mínima (Prim) del grafo de distancias del
 * clúster, lo recorre en preorden desde el depósito como recorrido inicial (garantiza a
 * lo sumo 2x el óptimo para TSP métrico) y lo refina con 2-opt. Devuelve también el peso
 * del árbol, útil como referencia de qué tan eficiente quedó la ruta final.
 */
export function solveRouteOrder(depotIndex: number, km: number[][]) {
  const grafo = construirGrafo(km);
  const mst = arbolExpansionMinima(grafo, depotIndex);
  const ordenInicial = ordenPorMst(mst, grafo, depotIndex);
  const optimized = twoOpt(ordenInicial, km);
  const withReturn = [...optimized, depotIndex];
  const distanciaTotalKm = routeLength(withReturn, km);
  return {
    order: withReturn,
    distanciaTotalKm,
    pesoMstKm: mst.pesoTotalKm,
    eficienciaRecorridoPct: mst.pesoTotalKm > 0 ? Math.round((mst.pesoTotalKm / distanciaTotalKm) * 1000) / 10 : 100,
  };
}
