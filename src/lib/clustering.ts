import { CargaPdv } from "./types";
import { LatLon, haversineKm } from "./distance";
import { DEPOT_ID, distanciaKmConCache } from "./distanceCache";

export interface ClusterInput {
  cargas: CargaPdv[];
  depot: LatLon;
  capacidadKg: number;
  factorCircuidadVial: number;
  radioMaximoViajeKm: number;
}

export interface Cluster {
  id: string;
  cargas: CargaPdv[];
  pesoTotalKg: number;
}

/**
 * Agrupamiento por PDV más cercano (sin importar provincia), respetando la capacidad
 * máxima del camión. No usa provincia ni ninguna división administrativa: dos PDV de
 * provincias distintas pero geográficamente vecinos (ej. un PDV en el límite entre Cañar
 * y Azuay) sí pueden terminar en el mismo camión si eso minimiza el recorrido real.
 *
 * Algoritmo (crecimiento voraz hacia el centroide, capacitado):
 *  1. Se arranca cada camión con el PDV sin asignar más lejano del depósito (ancla las
 *     zonas remotas primero, en vez de dejarlas de residuo al final).
 *  2. Mientras haya PDV sin asignar que quepan en el camión actual Y estén dentro del
 *     radio máximo configurado, se agrega el que esté más cerca del CENTROIDE del grupo
 *     que se está armando (no del último PDV agregado). Crecer hacia el centroide en vez
 *     de hacia "el vecino más cercano de cualquiera ya asignado" evita el efecto de
 *     "cadena": con vecino-más-cercano puro, un camión con capacidad para muchas paradas
 *     chicas puede terminar formando una fila larga y serpenteante que cruza medio país
 *     (cada salto es corto, pero la suma no); creciendo hacia el centroide el grupo se
 *     mantiene compacto y redondeado alrededor de su zona.
 *     Ningún candidato a más de `radioMaximoViajeKm` de la semilla del viaje (el ancla
 *     fija, no el centroide que se mueve) se considera, así se acota el área real que
 *     cubre el viaje y no solo cada salto individual de crecimiento.
 *  3. Cuando ya ningún PDV restante cabe o queda dentro del radio, se cierra el camión
 *     (aunque no haya llegado al 100% de capacidad) y se abre el siguiente con el mismo
 *     criterio — se prioriza que cada viaje quede geográficamente compacto por sobre
 *     llenar el camión a toda costa.
 *
 * La semilla y el radio máximo usan la caché de distancia real de carretera
 * (`npm run precalcular-distancias`). Solo el desempate "a cuál candidato elegir primero
 * entre los que ya calificaron" usa línea recta (Haversine) al centroide, porque el
 * centroide no es un PDV real y no tiene distancia de carretera propia — es un criterio de
 * orden, no de admisión; la distancia que se reporta sale de la ruta real ya armada con el
 * grafo de distancias reales.
 */
export function clusterByNearestPdv({
  cargas,
  depot,
  capacidadKg,
  factorCircuidadVial,
  radioMaximoViajeKm,
}: ClusterInput): Cluster[] {
  const distDepot = (c: CargaPdv) =>
    distanciaKmConCache(DEPOT_ID, depot, c.pdv.id, { lat: c.pdv.lat, lon: c.pdv.lon }, factorCircuidadVial);

  const restantes = new Set(cargas.map((_, i) => i));
  const clusters: Cluster[] = [];
  let clusterIdx = 1;

  while (restantes.size > 0) {
    // semilla: el PDV restante más lejano del depósito, para anclar primero las zonas remotas
    let semilla = -1;
    let mejorDist = -1;
    for (const i of restantes) {
      const d = distDepot(cargas[i]);
      if (d > mejorDist) {
        mejorDist = d;
        semilla = i;
      }
    }

    const puntoSemilla: LatLon = { lat: cargas[semilla].pdv.lat, lon: cargas[semilla].pdv.lon };
    const enCluster: number[] = [semilla];
    restantes.delete(semilla);
    let peso = cargas[semilla].pesoTotalKg;
    let sumLat = cargas[semilla].pdv.lat;
    let sumLon = cargas[semilla].pdv.lon;

    while (true) {
      const centroide: LatLon = { lat: sumLat / enCluster.length, lon: sumLon / enCluster.length };

      let mejorCandidato = -1;
      let mejorD = Infinity;
      for (const i of restantes) {
        if (peso + cargas[i].pesoTotalKg > capacidadKg) continue; // no cabe en este camión
        const punto = { lat: cargas[i].pdv.lat, lon: cargas[i].pdv.lon };
        // el radio se mide siempre desde la semilla fija del viaje (con distancia REAL de
        // carretera, no línea recta — en la sierra ecuatoriana dos puntos pueden estar
        // cerca en línea recta pero lejos por carretera por la cordillera de por medio), no
        // desde el centroide que se va moviendo a medida que crece el grupo.
        const distSemilla = distanciaKmConCache(cargas[semilla].pdv.id, puntoSemilla, cargas[i].pdv.id, punto, factorCircuidadVial);
        if (distSemilla > radioMaximoViajeKm) continue;
        const d = haversineKm(centroide, punto);
        if (d < mejorD) {
          mejorD = d;
          mejorCandidato = i;
        }
      }
      if (mejorCandidato === -1) break; // nada cabe ya, o nada queda dentro del radio del viaje

      enCluster.push(mejorCandidato);
      restantes.delete(mejorCandidato);
      peso += cargas[mejorCandidato].pesoTotalKg;
      sumLat += cargas[mejorCandidato].pdv.lat;
      sumLon += cargas[mejorCandidato].pdv.lon;
    }

    clusters.push({
      id: `Viaje ${clusterIdx++}`,
      cargas: enCluster.map((i) => cargas[i]),
      pesoTotalKg: Math.round(peso * 100) / 100,
    });
  }

  return clusters;
}

/**
 * Agrupamiento por RUTA PACTADA, respetando la capacidad del camión.
 *
 * POR QUÉ EXISTE ESTE MODO
 * ------------------------
 * El transportista cobra un precio fijo por ruta despachada (ver costModel.ts). Bajo ese
 * esquema, agrupar por cercanía geográfica ignorando las rutas sale CARO: un viaje que toca
 * tres rutas pactadas paga las tres, aunque recorra pocos kilómetros. Medido sobre una
 * semana real de Bogati, el agrupamiento geográfico costaba más del triple que despachar
 * por ruta.
 *
 * Aquí un despacho = una ruta pactada. Si la carga de una ruta no cabe en un camión, se
 * parte en tantos despachos como haga falta (cada uno paga el precio de esa ruta), metiendo
 * primero los PDV más pesados para que los camiones salgan lo más llenos posible y sobren
 * los menos despachos posibles.
 *
 * La palanca de ahorro deja de ser el kilometraje y pasa a ser el LLENADO: cada despacho
 * evitado vale el precio completo de la ruta (~$397 promedio en el histórico de Bogati).
 */
export function clusterByRutaPactada({
  cargas,
  capacidadKg,
}: Pick<ClusterInput, "cargas" | "capacidadKg">): Cluster[] {
  const porRuta = new Map<string, CargaPdv[]>();
  for (const carga of cargas) {
    const ruta = (carga.pdv.rutaActual || "").trim() || "SIN_RUTA";
    if (!porRuta.has(ruta)) porRuta.set(ruta, []);
    porRuta.get(ruta)!.push(carga);
  }

  const clusters: Cluster[] = [];
  for (const [ruta, delGrupo] of [...porRuta.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    // Más pesados primero: deja los livianos para rellenar huecos y evita abrir un despacho
    // extra solo para acomodar un PDV grande que ya no cabía.
    const pendientes = [...delGrupo].sort((a, b) => b.pesoTotalKg - a.pesoTotalKg);
    let viajeDeEstaRuta = 0;

    while (pendientes.length > 0) {
      const enViaje: CargaPdv[] = [];
      let peso = 0;
      for (let i = 0; i < pendientes.length; ) {
        // el `enViaje.length === 0` evita un bucle infinito si un solo PDV excede la capacidad
        if (peso + pendientes[i].pesoTotalKg <= capacidadKg || enViaje.length === 0) {
          peso += pendientes[i].pesoTotalKg;
          enViaje.push(pendientes[i]);
          pendientes.splice(i, 1);
        } else {
          i++;
        }
      }
      viajeDeEstaRuta++;
      clusters.push({
        id: viajeDeEstaRuta === 1 ? ruta : `${ruta} (${viajeDeEstaRuta})`,
        cargas: enViaje,
        pesoTotalKg: Math.round(peso * 100) / 100,
      });
    }
  }

  return clusters;
}
