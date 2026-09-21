import { CamionSemana, ConfigOptimizacion, RutaOptimizada } from "./types";
import { LatLon } from "./distance";

function angleFromDepot(depot: LatLon, punto: LatLon): number {
  const dLat = punto.lat - depot.lat;
  const dLon = punto.lon - depot.lon;
  let angle = Math.atan2(dLat, dLon);
  if (angle < 0) angle += 2 * Math.PI;
  return angle;
}

function centroide(viaje: RutaOptimizada): LatLon {
  const lat = viaje.paradas.reduce((a, p) => a + p.pdv.lat, 0) / viaje.paradas.length;
  const lon = viaje.paradas.reduce((a, p) => a + p.pdv.lon, 0) / viaje.paradas.length;
  return { lat, lon };
}

/**
 * Asigna cada viaje (ruta ya armada por capacidad/geografía) a uno de los N camiones
 * reales disponibles en la semana, procurando que un mismo camión trabaje siempre en la
 * misma zona del país en vez de saltar de una punta a otra entre un viaje y el siguiente.
 *
 * Usa el mismo principio de barrido angular que el agrupamiento de PDV en clústeres:
 * ordena los viajes por el ángulo de su centroide respecto al depósito (Ambato) — así
 * viajes vecinos geográficamente quedan adyacentes en la lista — y los reparte en ese
 * orden entre los camiones, llenando cada uno hasta su cuota de horas antes de pasar al
 * siguiente. El resultado: cada camión atiende una porción angular contigua del país
 * (ej. "todo lo del oriente" o "todo lo de la costa sur"), no una mezcla de puntos lejanos.
 */
export function asignarFlota(
  rutas: RutaOptimizada[],
  depot: LatLon,
  config: Pick<ConfigOptimizacion, "numeroCamionesDisponibles" | "horasDisponiblesPorCamionSemana">
): { rutas: RutaOptimizada[]; flota: CamionSemana[] } {
  const n = Math.max(1, config.numeroCamionesDisponibles);

  const bins: CamionSemana[] = Array.from({ length: n }, (_, i) => ({
    vehiculoId: i + 1,
    viajes: [],
    pesoTotalKg: 0,
    distanciaTotalKm: 0,
    horasTotales: 0,
    sobrecargado: false,
  }));

  const conAngulo = rutas.map((viaje) => ({ viaje, angulo: angleFromDepot(depot, centroide(viaje)) }));
  conAngulo.sort((a, b) => a.angulo - b.angulo);

  const horasTotalesSemana = rutas.reduce((a, r) => a + r.duracionEstimadaMin / 60, 0);
  const cuotaPorCamion = horasTotalesSemana / n;

  let binActual = 0;
  for (const { viaje } of conAngulo) {
    // avanza al siguiente camión si el actual ya cumplió su cuota y todavía quedan
    // camiones libres; un viaje nunca se parte entre dos camiones (siempre completo)
    while (
      binActual < n - 1 &&
      bins[binActual].horasTotales > 0 &&
      bins[binActual].horasTotales + viaje.duracionEstimadaMin / 60 > cuotaPorCamion
    ) {
      binActual++;
    }
    const bin = bins[binActual];
    viaje.vehiculoId = bin.vehiculoId;
    viaje.camionAsignado = `Camión ${bin.vehiculoId}`;
    bin.viajes.push(viaje);
    bin.pesoTotalKg = Math.round((bin.pesoTotalKg + viaje.pesoTotalKg) * 100) / 100;
    bin.distanciaTotalKm = Math.round((bin.distanciaTotalKm + viaje.distanciaTotalKm) * 10) / 10;
    bin.horasTotales = Math.round((bin.horasTotales + viaje.duracionEstimadaMin / 60) * 100) / 100;
  }

  // Rebalanceo: el barrido angular por sí solo puede dejar toda una región muy cargada
  // (ej. más pedidos en el sur del país que los que un solo camión puede cubrir en la
  // semana) apilada en el último camión. Se corrige moviendo, de a un viaje por vez, el
  // viaje del camión más cargado cuyo centroide quede geográficamente más cerca del
  // camión menos cargado — se sigue priorizando la cercanía geográfica, no solo las horas.
  const angulos = new Map(conAngulo.map(({ viaje, angulo }) => [viaje.id, angulo]));
  const anguloPromedio = (bin: CamionSemana) =>
    bin.viajes.reduce((a, v) => a + (angulos.get(v.id) ?? 0), 0) / (bin.viajes.length || 1);

  for (let iter = 0; iter < 50; iter++) {
    const max = bins.reduce((m, b) => (b.horasTotales > m.horasTotales ? b : m), bins[0]);
    const min = bins.reduce((m, b) => (b.horasTotales < m.horasTotales ? b : m), bins[0]);
    if (max.horasTotales <= config.horasDisponiblesPorCamionSemana) break; // nadie sobrecargado, listo
    if (max.viajes.length <= 1) break; // no se puede aliviar sin dejar un camión vacío
    if (max.horasTotales - min.horasTotales < 1) break; // ya está lo balanceado posible

    const anguloDestino = anguloPromedio(min);
    let mejorIdx = 0;
    let mejorDist = Infinity;
    max.viajes.forEach((v, idx) => {
      const d = Math.abs((angulos.get(v.id) ?? 0) - anguloDestino);
      if (d < mejorDist) {
        mejorDist = d;
        mejorIdx = idx;
      }
    });
    const [viaje] = max.viajes.splice(mejorIdx, 1);
    const horas = viaje.duracionEstimadaMin / 60;
    if (max.horasTotales - horas < min.horasTotales) break; // moverlo empeoraría el balance, se detiene

    max.horasTotales = Math.round((max.horasTotales - horas) * 100) / 100;
    max.pesoTotalKg = Math.round((max.pesoTotalKg - viaje.pesoTotalKg) * 100) / 100;
    max.distanciaTotalKm = Math.round((max.distanciaTotalKm - viaje.distanciaTotalKm) * 10) / 10;

    viaje.vehiculoId = min.vehiculoId;
    viaje.camionAsignado = `Camión ${min.vehiculoId}`;
    min.viajes.push(viaje);
    min.horasTotales = Math.round((min.horasTotales + horas) * 100) / 100;
    min.pesoTotalKg = Math.round((min.pesoTotalKg + viaje.pesoTotalKg) * 100) / 100;
    min.distanciaTotalKm = Math.round((min.distanciaTotalKm + viaje.distanciaTotalKm) * 10) / 10;
  }

  for (const bin of bins) {
    bin.sobrecargado = bin.horasTotales > config.horasDisponiblesPorCamionSemana;
    // se ordenan los viajes de cada camión por peso descendente para que en la UI se vea
    // primero lo más grande/urgente de programar
    bin.viajes.sort((a, b) => b.pesoTotalKg - a.pesoTotalKg);
  }

  return { rutas, flota: bins.filter((b) => b.viajes.length > 0) };
}
