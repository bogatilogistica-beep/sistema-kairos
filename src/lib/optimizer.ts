import { CargaPdv, ConfigOptimizacion, ParadaRuta, PedidoItem, ResultadoOptimizacion, RutaOptimizada } from "./types";
import { clusterByNearestPdv, clusterByRutaPactada } from "./clustering";
import { consolidarDespachos } from "./consolidacion";
import { getDistanceMatrix, LatLon } from "./distance";
import { DEPOT_ID, distanciaKmConCache } from "./distanceCache";
import { solveRouteOrder } from "./tsp";
import { asignarCostoPorPdv, cargaBajoMinimo, costoActualReferencia, costoViajeUsd } from "./costModel";
import { asignarFlota } from "./fleet";
import { PDV_MASTER, COBRO_ACTUAL, VENTANAS_HORARIAS } from "./pdvData";
import { calcularHorarios, distanciaDeOrden, formatoHora, minutosDesdeMedianoche, reordenarPorVentanas } from "./ventanas";

function agruparPorPdv(items: PedidoItem[]): CargaPdv[] {
  const pdvById = new Map(PDV_MASTER.map((p) => [p.id, p]));
  const porPdv = new Map<string, PedidoItem[]>();
  for (const item of items) {
    if (!porPdv.has(item.pdvId)) porPdv.set(item.pdvId, []);
    porPdv.get(item.pdvId)!.push(item);
  }

  const cargas: CargaPdv[] = [];
  for (const [pdvId, its] of porPdv.entries()) {
    const pdv = pdvById.get(pdvId);
    if (!pdv) continue;
    cargas.push({
      pdv,
      pesoTotalKg: Math.round(its.reduce((a, i) => a + i.pesoKg, 0) * 100) / 100,
      categorias: [...new Set(its.map((i) => i.categoria))],
      items: its,
    });
  }
  return cargas;
}

/** Distancia marginal de insertar cada parada en la posición que ocupa dentro del recorrido óptimo. */
function calcularDistanciasMarginales(orderIdx: number[], km: number[][]): number[] {
  // orderIdx incluye depósito al inicio (0) y al final; retorna un valor por cada parada
  // intermedia (sin contar el depósito), en el mismo orden que aparecen en orderIdx[1..-2].
  const marginales: number[] = [];
  for (let i = 1; i < orderIdx.length - 1; i++) {
    const prev = orderIdx[i - 1];
    const cur = orderIdx[i];
    const next = orderIdx[i + 1];
    const delta = km[prev][cur] + km[cur][next] - km[prev][next];
    marginales.push(Math.max(0, delta));
  }
  return marginales;
}

export async function optimizarSemana(
  items: PedidoItem[],
  config: ConfigOptimizacion & { depot: LatLon },
  semana: string
): Promise<ResultadoOptimizacion> {
  const cargas = agruparPorPdv(items);
  const pdvSinCoordenadaValida = cargas.filter((c) => !c.pdv.coordenadaValidada).map((c) => c.pdv.id);

  // Por defecto se agrupa por ruta pactada, porque el transportista cobra precio fijo por
  // ruta despachada: un viaje que mezcla rutas paga todas las que toca. El modo geográfico
  // ("cercania") solo conviene si algún día se pasa a una tarifa por kilómetro.
  const clustersBase =
    config.modoAgrupamiento === "cercania"
      ? clusterByNearestPdv({
          cargas,
          depot: config.depot,
          capacidadKg: config.capacidadCamionKg,
          factorCircuidadVial: config.factorCircuidadVial,
          radioMaximoViajeKm: config.radioMaximoViajeKm,
        })
      : clusterByRutaPactada({ cargas, capacidadKg: config.capacidadCamionKg });

  // Fusiona despachos que salen a medio llenar hacia zonas vecinas: como se paga por ruta
  // despachada, dos camiones al 12% cuestan el doble que uno al 24% recorriendo casi lo mismo.
  const { clusters, fusiones, ahorroTotalUsd: ahorroPorFusionUsd, fueraDeJornada } =
    config.consolidarDespachos === false
      ? { clusters: clustersBase, fusiones: [], ahorroTotalUsd: 0, fueraDeJornada: [] }
      : consolidarDespachos(clustersBase, config);

  const rutas: RutaOptimizada[] = [];
  const pisoSalidaMin = minutosDesdeMedianoche(config.horaMasTempranoCarga) + config.duracionCargaMin;
  const horaAperturaGeneralMin = minutosDesdeMedianoche(config.horaAperturaGeneral);

  for (const cluster of clusters) {
    const puntos: LatLon[] = [config.depot, ...cluster.cargas.map((c) => ({ lat: c.pdv.lat, lon: c.pdv.lon }))];
    const ids: string[] = [DEPOT_ID, ...cluster.cargas.map((c) => c.pdv.id)];
    const { provider, km, minutes } = await getDistanceMatrix(
      puntos,
      config.factorCircuidadVial,
      config.velocidadPromedioKmh,
      ids
    );

    const { order: ordenBase, pesoMstKm, eficienciaRecorridoPct } = solveRouteOrder(0, km);

    // índice dentro de `km`/`order` (1..n, el 0 es el depósito) -> hora límite en minutos,
    // para los PDV de este viaje que tengan ventana horaria configurada
    const deadlinePorIndice = new Map<number, number>();
    cluster.cargas.forEach((c, i) => {
      const limite = VENTANAS_HORARIAS[c.pdv.id];
      if (limite) deadlinePorIndice.set(i + 1, minutosDesdeMedianoche(limite));
    });

    const order = reordenarPorVentanas(ordenBase, km, deadlinePorIndice);
    const distanciaTotalKm = distanciaDeOrden(order, km);
    const marginales = calcularDistanciasMarginales(order, km);

    const { horaSalidaMin, llegadas, alerta } = calcularHorarios(
      order,
      minutes,
      config.minutosPorParada,
      deadlinePorIndice,
      horaAperturaGeneralMin,
      pisoSalidaMin
    );

    const duracionMin =
      order.slice(0, -1).reduce((acc, idx, i) => acc + minutes[idx][order[i + 1]], 0) +
      config.minutosPorParada * cluster.cargas.length;

    // El transportista cobra precio fijo por ruta despachada, así que el costo del viaje
    // depende de qué rutas pactadas toca, no de los km que recorre (ver costModel.ts).
    const rutasDelViaje = [...new Set(cluster.cargas.map((c) => c.pdv.rutaActual).filter(Boolean))] as string[];
    const cargasDelViaje = cluster.cargas.map((c) => ({ pdvId: c.pdv.id, categorias: c.categorias }));
    const { bajoMinimo, detalle: detalleMinimoCarga } = cargaBajoMinimo(cluster.cargas, config.minimosCarga);
    const costoTotalViajeUsd = costoViajeUsd(
      cluster.pesoTotalKg,
      distanciaTotalKm,
      config.costoFormula,
      rutasDelViaje,
      cargasDelViaje
    );

    const paradasBase: Omit<ParadaRuta, "costoAsignadoUsd">[] = order.slice(1, -1).map((idx, i) => {
      const carga = cluster.cargas[idx - 1];
      const horaLimiteStr = VENTANAS_HORARIAS[carga.pdv.id] ?? null;
      return {
        pdv: carga.pdv,
        ordenVisita: i + 1,
        pesoKg: carga.pesoTotalKg,
        categorias: carga.categorias,
        distanciaDesdeAnteriorKm: km[order[i]][idx],
        distanciaMarginalKm: marginales[i],
        horaLlegadaEstimada: formatoHora(llegadas[i]),
        horaLimite: horaLimiteStr,
        incumpleVentana: horaLimiteStr !== null && llegadas[i] > minutosDesdeMedianoche(horaLimiteStr),
      };
    });

    const paradas = asignarCostoPorPdv({
      paradas: paradasBase,
      costoTotalViajeUsd,
      pesoTotalKg: cluster.pesoTotalKg,
      distanciaTotalKm,
      pesoAsignacionPct: config.pesoAsignacionPct,
    });

    const costoActualEstimadoUsd = costoActualReferencia(cluster.cargas, COBRO_ACTUAL);

    rutas.push({
      id: cluster.id,
      camionAsignado: "",
      vehiculoId: 0,
      paradas,
      pesoTotalKg: cluster.pesoTotalKg,
      capacidadUtilizadaPct: Math.round((cluster.pesoTotalKg / config.capacidadCamionKg) * 1000) / 10,
      distanciaTotalKm: Math.round(distanciaTotalKm * 10) / 10,
      pesoMstKm: Math.round(pesoMstKm * 10) / 10,
      eficienciaRecorridoPct,
      duracionEstimadaMin: Math.round(duracionMin),
      costoTotalViajeUsd: Math.round(costoTotalViajeUsd * 100) / 100,
      costoActualEstimadoUsd: Math.round(costoActualEstimadoUsd * 100) / 100,
      ahorroUsd: Math.round((costoActualEstimadoUsd - costoTotalViajeUsd) * 100) / 100,
      proveedorDistancia: provider,
      horaSalidaEstimada: formatoHora(horaSalidaMin),
      alertaHorario: alerta,
      cargaBajoMinimoTransportista: bajoMinimo,
      detalleMinimoCarga,
    });
  }

  const { flota } = asignarFlota(rutas, config.depot, config);

  const pdvConPedido = new Set(cargas.map((c) => c.pdv.id));
  const pdvSinPedido = PDV_MASTER.filter((p) => !pdvConPedido.has(p.id)).map((p) => p.id);

  // Línea base real: cuánto costaría si cada PDV se despachara en un viaje propio, sin
  // compartir camión con nadie (la alternativa "sin optimizar" contra la que sí tiene
  // sentido medir el ahorro de consolidar rutas). Se usa Haversine para esta comparación
  // aunque el proveedor real esté activo, porque es una línea base agregada y no debe
  // multiplicar las llamadas a la API de distancias por cada PDV.
  const costoSinConsolidarUsd = cargas.reduce((acc, carga) => {
    const ida = distanciaKmConCache(
      DEPOT_ID,
      config.depot,
      carga.pdv.id,
      { lat: carga.pdv.lat, lon: carga.pdv.lon },
      config.factorCircuidadVial
    );
    // un viaje por PDV: cada uno pagaría el precio completo de su ruta
    return (
      acc +
      costoViajeUsd(carga.pesoTotalKg, ida * 2, config.costoFormula, [carga.pdv.rutaActual as string], [
        { pdvId: carga.pdv.id, categorias: carga.categorias },
      ])
    );
  }, 0);

  const costoTotalOptimizadoUsd = Math.round(rutas.reduce((a, r) => a + r.costoTotalViajeUsd, 0) * 100) / 100;
  const costoTotalActualUsd = Math.round(rutas.reduce((a, r) => a + r.costoActualEstimadoUsd, 0) * 100) / 100;
  const ahorroPorConsolidacionUsd = Math.round((costoSinConsolidarUsd - costoTotalOptimizadoUsd) * 100) / 100;

  const totales = {
    pesoTotalKg: Math.round(cargas.reduce((a, c) => a + c.pesoTotalKg, 0) * 100) / 100,
    numViajes: rutas.length,
    numCamionesDisponibles: config.numeroCamionesDisponibles,
    numCamionesUsados: flota.length,
    camionesSobrecargados: flota.filter((f) => f.sobrecargado).length,
    costoTotalOptimizadoUsd,
    costoTotalActualUsd,
    ahorroTotalUsd: Math.round(rutas.reduce((a, r) => a + r.ahorroUsd, 0) * 100) / 100,
    ahorroPct: 0,
    costoSinConsolidarUsd: Math.round(costoSinConsolidarUsd * 100) / 100,
    ahorroPorConsolidacionUsd,
    ahorroPorConsolidacionPct: 0,
    distanciaTotalKm: Math.round(rutas.reduce((a, r) => a + r.distanciaTotalKm, 0) * 10) / 10,
    // Como se paga por despacho y no por kilómetro, el llenado de los camiones es la
    // métrica que realmente mueve la factura: cada despacho evitado vale una ruta completa.
    llenadoPromedioPct:
      rutas.length > 0
        ? Math.round((rutas.reduce((a, r) => a + r.capacidadUtilizadaPct, 0) / rutas.length) * 10) / 10
        : 0,
    viajesMinimosPorCapacidad: Math.ceil(
      cargas.reduce((a, c) => a + c.pesoTotalKg, 0) / config.capacidadCamionKg
    ),
    despachosEvitables: 0,
    /** Fusiones de rutas flacas aplicadas y lo que ahorraron. */
    fusionesAplicadas: fusiones,
    ahorroPorFusionUsd,
    despachosFueraDeJornada: fueraDeJornada,
    despachosBajoMinimo: rutas.filter((r) => r.cargaBajoMinimoTransportista).length,
  };
  totales.despachosEvitables = Math.max(0, totales.numViajes - totales.viajesMinimosPorCapacidad);
  totales.ahorroPct = totales.costoTotalActualUsd > 0 ? Math.round((totales.ahorroTotalUsd / totales.costoTotalActualUsd) * 1000) / 10 : 0;
  totales.ahorroPorConsolidacionPct =
    totales.costoSinConsolidarUsd > 0 ? Math.round((ahorroPorConsolidacionUsd / totales.costoSinConsolidarUsd) * 1000) / 10 : 0;

  return { semana, rutas, flota, pdvSinPedido, pdvSinCoordenadaValida, totales };
}
