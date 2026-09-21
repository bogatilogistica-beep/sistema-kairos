import { CargaPdv, Categoria, ConfigOptimizacion, ParadaRuta } from "./types";
import { COSTOS_HISTORICOS, COSTOS_ORDINARIOS_APERTURAS } from "./pdvData";
import { DEFAULT_DENSITY_KG_POR_LITRO } from "./productWeights";

/**
 * Costo total estimado de un viaje/ruta.
 *
 * CÓMO COBRA REALMENTE EL TRANSPORTISTA
 * -------------------------------------
 * Precio FIJO por ruta despachada: no cobra por kilómetro ni por kilo. Verificado sobre
 * los 259 viajes del histórico (scripts/calibrar-costos.ts):
 *   - QUITO $250, LA MANA $410 y RIOBAMBA $125 aparecen con el MISMO precio en el 100%
 *     de sus viajes; la mayoría del resto varía menos del 5%.
 *   - La correlación entre costo y kg transportados es ruido (r entre -0.22 y +0.29).
 *
 * Por eso se usa la tabla precio-por-ruta. La fórmula lineal alpha + beta*kg + gamma*km
 * queda solo como respaldo para viajes que no corresponden a ninguna ruta con precio
 * pactado (PDV nuevos, zonas aún no negociadas). Ese respaldo sobreestimaba las rutas
 * reales en +45% incluso después de recalibrarlo, porque ajusta un plano a lo que en
 * realidad es una función escalón.
 *
 * CONSECUENCIA OPERATIVA: el costo depende de CUÁNTOS despachos se hacen, no de qué tan
 * largos son. Acortar kilómetros dentro de un viaje no baja la factura; consolidar viajes sí.
 */
export function costoViajeUsd(
  pesoTotalKg: number,
  distanciaTotalKm: number,
  formula: ConfigOptimizacion["costoFormula"],
  rutasDelViaje?: string[],
  cargasDelViaje?: { pdvId: string; categorias: Categoria[] }[]
): number {
  const pactado = precioPactadoUsd(rutasDelViaje);
  if (pactado !== null) return pactado;

  // Sin precio pactado (PDV nuevo/ruta aún no negociada): la tabla de costos ORDINARIOS de
  // aperturas trae, PDV por PDV, el costo real de transporte. Cuando todos los PDV del viaje
  // están en esa tabla es un respaldo más fiel que la fórmula lineal, que sobreestima viajes
  // reales en +45% (ver nota arriba).
  const ordinario = cargasDelViaje ? costoOrdinarioViajeUsd(cargasDelViaje) : null;
  if (ordinario !== null) return ordinario;

  return formula.alpha + formula.beta * pesoTotalKg + formula.gamma * distanciaTotalKm;
}

/**
 * Costo ordinario de transporte de un PDV según la tabla de aperturas, o null si no está ahí.
 *
 * La tabla es una BASE, no una tarifa fija a ciegas: su total por PDV asume que ese PDV
 * recibe helado + queso + crema juntos (el mix con el que se armó el archivo). Si esta
 * semana solo viaja una parte del mix, cobrar el total completo sobreestima el viaje —
 * por eso se reajusta a los componentes de la propia tabla que sí aplican (más insumos y
 * envases, que van en cualquier despacho, lleve lo que lleve).
 */
export function costoOrdinarioPdvUsd(pdvId: string, categoriasEnviadas?: Categoria[]): number | null {
  const entrada = COSTOS_ORDINARIOS_APERTURAS[pdvId];
  if (!entrada) return null;

  if (!categoriasEnviadas || categoriasEnviadas.length === 0) return entrada.totalRedondeadoUsd;

  const set = new Set(categoriasEnviadas);
  const vaElMixCompleto = set.has("HELADO") && set.has("QUESO") && set.has("CREMA");
  if (vaElMixCompleto) return entrada.totalRedondeadoUsd;

  let subtotal = entrada.insumosUsd + entrada.envasesUsd;
  if (set.has("HELADO")) subtotal += entrada.heladoUsd;
  if (set.has("QUESO")) subtotal += entrada.quesoUsd;
  if (set.has("CREMA")) subtotal += entrada.cremaUsd;
  return Math.round(subtotal * 100) / 100;
}

/**
 * Suma el costo ordinario de aperturas de cada PDV del viaje (ya reajustado a su propio mix
 * de categorías). Solo se usa como costo del viaje cuando TODOS los PDV están en la tabla
 * (igual que precioPactadoUsd con las rutas): mezclar un dato real con una estimación no es
 * mejor que usar la estimación completa.
 */
export function costoOrdinarioViajeUsd(cargasDelViaje: { pdvId: string; categorias: Categoria[] }[]): number | null {
  if (cargasDelViaje.length === 0) return null;
  let total = 0;
  for (const { pdvId, categorias } of cargasDelViaje) {
    const costo = costoOrdinarioPdvUsd(pdvId, categorias);
    if (costo === null) return null;
    total += costo;
  }
  return Math.round(total * 100) / 100;
}

const NOMBRE_CATEGORIA: Record<Categoria, string> = {
  HELADO: "Helado",
  QUESO: "Queso",
  CREMA: "Crema de leche",
};

/** Cantidad mínima por categoría (kg equivalentes), derivada de config.minimosCarga con las densidades del sistema. */
export function minimosCargaKg(
  minimosCarga: NonNullable<ConfigOptimizacion["minimosCarga"]>
): Record<Categoria, number> {
  return {
    HELADO: minimosCarga.heladoTachos * minimosCarga.litrosPorTachoHelado * DEFAULT_DENSITY_KG_POR_LITRO.HELADO,
    QUESO: minimosCarga.quesoUnidades * minimosCarga.kgPorUnidadQueso,
    CREMA: minimosCarga.cremaLitros * DEFAULT_DENSITY_KG_POR_LITRO.CREMA,
  };
}

/**
 * Revisa, para un viaje, si algún producto que sí se despacha en él no llega a la cantidad
 * mínima del transportista (config.minimosCarga). Solo evalúa categorías presentes en el
 * viaje: un viaje sin queso no se marca por "queso bajo el mínimo".
 */
export function cargaBajoMinimo(
  cargasDelViaje: CargaPdv[],
  minimosCarga: ConfigOptimizacion["minimosCarga"]
): { bajoMinimo: boolean; detalle: string | null } {
  if (!minimosCarga) return { bajoMinimo: false, detalle: null };

  const pesoPorCategoria: Partial<Record<Categoria, number>> = {};
  for (const carga of cargasDelViaje) {
    for (const item of carga.items) {
      pesoPorCategoria[item.categoria] = (pesoPorCategoria[item.categoria] ?? 0) + item.pesoKg;
    }
  }

  const minimos = minimosCargaKg(minimosCarga);
  const faltantes: string[] = [];
  for (const [categoria, pesoKg] of Object.entries(pesoPorCategoria) as [Categoria, number][]) {
    const minimoKg = minimos[categoria];
    if (pesoKg < minimoKg) {
      faltantes.push(`${NOMBRE_CATEGORIA[categoria]}: ${Math.round(pesoKg * 10) / 10}kg de ${Math.round(minimoKg * 10) / 10}kg mínimo`);
    }
  }

  if (faltantes.length === 0) return { bajoMinimo: false, detalle: null };
  return { bajoMinimo: true, detalle: `Bajo el mínimo del transportista — ${faltantes.join(" · ")}` };
}

/** Nombres de ruta del maestro de PDV (rutaActual) -> nombres del histórico de facturas. */
const RUTA_A_HISTORICO: Record<string, string> = {
  QUITO: "QUITO",
  GYE: "GUAYAS",
  "MCS-PYO": "MACAS-PUYO",
  IMB: "IMBABURA",
  RBB: "RIOBAMBA",
  AMB: "AMBATO",
  CUE: "CUENCA",
  LOJA: "LOJA",
  MAB: "MANABI",
  MACHLA: "MACHALA",
  LAMANA: "LA MANA",
  ESM: "ESMERALDAS",
  ORIENTE: "ORIENTE",
  PLAYAS: "PLAYAS",
  BOLGY: "BOLGY",
};

/**
 * Cuando un viaje abarca varias rutas pactadas, el transportista no cobra la suma completa:
 * en los dos únicos casos del histórico (CUENCA-LOJA $900 sobre $1.090 sumados, y
 * GUAYAS-PLAYAS $780 sobre $850) cobró alrededor del 87% de la suma. Con solo dos muestras
 * este factor es una aproximación, no un precio confirmado: conviene validarlo con el
 * transportista antes de comprometer un ahorro que dependa de consolidar rutas distintas.
 */
const FACTOR_RUTA_COMBINADA = 0.87;

/** Precio pactado del viaje según las rutas que toca, o null si alguna no tiene precio. */
export function precioPactadoUsd(rutasDelViaje?: string[]): number | null {
  const tabla = (COSTOS_HISTORICOS as any)?.porRuta as
    | Record<string, { precioRuta?: number }>
    | undefined;
  if (!tabla || !rutasDelViaje || rutasDelViaje.length === 0) return null;

  const precios: number[] = [];
  for (const ruta of [...new Set(rutasDelViaje)]) {
    const clave = RUTA_A_HISTORICO[ruta] ?? ruta;
    const precio = tabla[clave]?.precioRuta;
    if (typeof precio !== "number" || precio <= 0) return null; // ruta sin precio: se usa el respaldo lineal
    precios.push(precio);
  }
  if (precios.length === 1) return precios[0];
  return precios.reduce((a, b) => a + b, 0) * FACTOR_RUTA_COMBINADA;
}

interface AsignarCostoInput {
  paradas: Omit<ParadaRuta, "costoAsignadoUsd">[];
  costoTotalViajeUsd: number;
  pesoTotalKg: number;
  distanciaTotalKm: number;
  pesoAsignacionPct: number; // 0-1
}

/**
 * Asigna a cada PDV el costo de su parada dentro del viaje.
 *
 * Prioridad 1: si el PDV está en la tabla de costos ORDINARIOS de aperturas, se le asigna
 * DIRECTAMENTE ese número — es un costo real por tienda (helado+queso+crema+insumos+
 * envases), más confiable que cualquier prorrateo, con o sin ruta pactada.
 *
 * Prioridad 2 (solo para los PDV que no están en esa tabla): se prorratea lo que queda del
 * costo del viaje (costoTotalViajeUsd menos lo ya asignado directamente) combinando dos
 * criterios:
 *  - Participación en el peso transportado (¿cuánto ocupó del camión?)
 *  - Participación en la distancia marginal (¿cuánto se desvió/alargó la ruta por visitarlo?)
 *
 * Esto evita cobrar lo mismo a un PDV que recibe 50kg estando de paso que a uno que recibe
 * 50kg pero obliga a un desvío grande — más justo y más defendible frente al comité ("números reales")
 * que repartir el costo del viaje en partes iguales.
 */
export function asignarCostoPorPdv({
  paradas,
  costoTotalViajeUsd,
  pesoAsignacionPct,
}: AsignarCostoInput): ParadaRuta[] {
  const costoDirectoPorPdv = new Map<string, number>();
  for (const parada of paradas) {
    const costo = costoOrdinarioPdvUsd(parada.pdv.id, parada.categorias);
    if (costo !== null) costoDirectoPorPdv.set(parada.pdv.id, costo);
  }

  const paradasSinDato = paradas.filter((p) => !costoDirectoPorPdv.has(p.pdv.id));
  const costoAsignadoDirectoTotal = [...costoDirectoPorPdv.values()].reduce((a, b) => a + b, 0);
  const costoRestante = Math.max(0, costoTotalViajeUsd - costoAsignadoDirectoTotal);

  const pesoSinDatoTotal = paradasSinDato.reduce((acc, p) => acc + p.pesoKg, 0);
  const distanciaMarginalSinDatoTotal = paradasSinDato.reduce((acc, p) => acc + p.distanciaMarginalKm, 0) || 1;

  return paradas.map((parada) => {
    const directo = costoDirectoPorPdv.get(parada.pdv.id);
    if (directo !== undefined) {
      return { ...parada, costoAsignadoUsd: directo };
    }

    const shareRelativoPeso =
      pesoSinDatoTotal > 0 ? parada.pesoKg / pesoSinDatoTotal : 1 / paradasSinDato.length;
    const shareRelativoDistancia = parada.distanciaMarginalKm / distanciaMarginalSinDatoTotal;

    const share =
      pesoAsignacionPct * shareRelativoPeso + (1 - pesoAsignacionPct) * shareRelativoDistancia;

    return {
      ...parada,
      costoAsignadoUsd: Math.round(costoRestante * share * 100) / 100,
    };
  });
}

/** Costo actual de referencia ("antes") usando la tarifa fija por PDV de COBRO DE TRANSPORTE. */
export function costoActualReferencia(
  cargas: CargaPdv[],
  tarifasActuales: Record<string, number>
): number {
  return cargas.reduce((acc, carga) => acc + (tarifasActuales[carga.pdv.id] ?? 0), 0);
}
