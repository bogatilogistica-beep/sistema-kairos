/**
 * Motor de rutas basado en teoría de grafos.
 *
 * Cada clúster de PDV (una carga de camión) se modela como un grafo completo ponderado:
 * nodos = depósito + PDV del clúster, aristas = distancia real entre cada par (de
 * distance.ts: Google/Mapbox si hay API key, o Haversine + factor vial si no). Sobre ese
 * grafo se calculan dos cosas:
 *
 *  - Árbol de expansión mínima (MST, algoritmo de Prim): el costo mínimo teórico para que
 *    el camión pueda "alcanzar" a todos los PDV del clúster, conectados entre sí de la
 *    forma más barata posible. Se usa como base para construir el recorrido inicial
 *    (recorrer el árbol en preorden desde el depósito es una heurística clásica con
 *    garantía matemática de a lo sumo 2x el óptimo para TSP métrico) y como referencia
 *    para medir qué tan eficiente quedó la ruta final tras el refinamiento 2-opt.
 *  - Camino más corto (algoritmo de Dijkstra) desde el depósito a cada PDV: sirve para
 *    validar que ninguna arista directa del grafo es en realidad más cara que pasar por
 *    un PDV intermedio (lo cual, si pasara, indicaría un dato de distancia inconsistente).
 */

export interface Grafo {
  n: number;
  pesos: number[][]; // pesos[i][j] = peso (km) de la arista entre nodo i y nodo j
}

export function construirGrafo(matrizDistancias: number[][]): Grafo {
  return { n: matrizDistancias.length, pesos: matrizDistancias };
}

export interface AristaMst {
  desde: number;
  hasta: number;
  pesoKm: number;
}

export interface ArbolExpansionMinima {
  aristas: AristaMst[];
  pesoTotalKm: number;
  adyacencia: Map<number, number[]>; // nodo -> vecinos en el árbol
}

/** Árbol de expansión mínima por el algoritmo de Prim. O(n²), adecuado para clústeres pequeños (un camión). */
export function arbolExpansionMinima(grafo: Grafo, raiz = 0): ArbolExpansionMinima {
  const { n, pesos } = grafo;
  const enArbol = new Array(n).fill(false);
  const costoMinimo = new Array(n).fill(Infinity);
  const padre = new Array(n).fill(-1);
  costoMinimo[raiz] = 0;

  const aristas: AristaMst[] = [];
  let pesoTotalKm = 0;
  const adyacencia = new Map<number, number[]>();
  for (let i = 0; i < n; i++) adyacencia.set(i, []);

  for (let iter = 0; iter < n; iter++) {
    let u = -1;
    for (let i = 0; i < n; i++) {
      if (!enArbol[i] && (u === -1 || costoMinimo[i] < costoMinimo[u])) u = i;
    }
    if (u === -1 || costoMinimo[u] === Infinity) break;
    enArbol[u] = true;
    if (padre[u] !== -1) {
      aristas.push({ desde: padre[u], hasta: u, pesoKm: costoMinimo[u] });
      pesoTotalKm += costoMinimo[u];
      adyacencia.get(padre[u])!.push(u);
      adyacencia.get(u)!.push(padre[u]);
    }
    for (let v = 0; v < n; v++) {
      if (!enArbol[v] && pesos[u][v] < costoMinimo[v]) {
        costoMinimo[v] = pesos[u][v];
        padre[v] = u;
      }
    }
  }

  return { aristas, pesoTotalKm: Math.round(pesoTotalKm * 100) / 100, adyacencia };
}

/**
 * Recorre el árbol de expansión mínima en preorden (profundidad) desde la raíz. Da un
 * orden inicial de visita a los PDV que respeta la estructura de menor costo del grafo —
 * mejor punto de partida para el refinamiento 2-opt que un simple "vecino más cercano".
 */
export function ordenPorMst(mst: ArbolExpansionMinima, grafo: Grafo, raiz: number): number[] {
  const visitado = new Array(grafo.n).fill(false);
  const orden: number[] = [];

  function dfs(nodo: number) {
    visitado[nodo] = true;
    orden.push(nodo);
    const vecinos = [...(mst.adyacencia.get(nodo) ?? [])].sort(
      (a, b) => grafo.pesos[nodo][a] - grafo.pesos[nodo][b]
    );
    for (const v of vecinos) {
      if (!visitado[v]) dfs(v);
    }
  }
  dfs(raiz);
  return orden;
}

export interface ResultadoDijkstra {
  distancias: number[];
  previos: (number | null)[];
}

/** Camino más corto desde `origen` a todos los demás nodos. O(n²), adecuado para clústeres pequeños. */
export function dijkstra(grafo: Grafo, origen: number): ResultadoDijkstra {
  const { n, pesos } = grafo;
  const distancias = new Array(n).fill(Infinity);
  const visitado = new Array(n).fill(false);
  const previos: (number | null)[] = new Array(n).fill(null);
  distancias[origen] = 0;

  for (let iter = 0; iter < n; iter++) {
    let u = -1;
    for (let i = 0; i < n; i++) {
      if (!visitado[i] && (u === -1 || distancias[i] < distancias[u])) u = i;
    }
    if (u === -1 || distancias[u] === Infinity) break;
    visitado[u] = true;
    for (let v = 0; v < n; v++) {
      if (!visitado[v] && pesos[u][v] > 0) {
        const alt = distancias[u] + pesos[u][v];
        if (alt < distancias[v]) {
          distancias[v] = alt;
          previos[v] = u;
        }
      }
    }
  }
  return { distancias, previos };
}
