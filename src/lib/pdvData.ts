import pdvMasterJson from "../../data/pdv-master.json";
import rutasActualesJson from "../../data/rutas-actuales.json";
import cobroActualJson from "../../data/cobro-actual.json";
import costosHistoricosJson from "../../data/costos-historicos.json";
import configDefaultJson from "../../data/config-default.json";
import dataQualityJson from "../../data/data-quality-report.json";
import productosConversionJson from "../../data/productos-conversion.json";
import ventanasHorariasJson from "../../data/ventanas-horarias.json";
import costosOrdinariosAperturasJson from "../../data/costos-ordinarios-aperturas.json";
import tarifaObjetivoPdvJson from "../../data/tarifa-objetivo-pdv.json";
import type { Pdv, ConfigOptimizacion } from "./types";
import type { ProductoConversion } from "./productWeights";

export const PDV_MASTER = pdvMasterJson as Pdv[];
export const RUTAS_ACTUALES = rutasActualesJson as Record<
  string,
  { provincia: string; pdvIds: string[]; distanciaEstimadaKm: number }
>;
export const COBRO_ACTUAL = cobroActualJson as Record<string, number>;
export const COSTOS_HISTORICOS = costosHistoricosJson as unknown as {
  /** "precio-fijo-por-ruta": el transportista cobra por ruta despachada, no por km ni por kg. */
  modelo: string;
  nota: string;
  /** Precio pactado por ruta, calibrado con la mediana del histórico de facturas. */
  porRuta: Record<
    string,
    {
      precioRuta: number;
      numViajes: number;
      /** Coeficiente de variación del precio en el histórico (%). Cerca de 0 = tarifa plana confirmada. */
      variacionPct: number;
      avgKg: number;
      avgPdv: number;
      kmEstimados: number | null;
      costoPorKm: number | null;
    }
  >;
  /** Ajuste lineal, solo como respaldo para rutas sin precio pactado. */
  regresion: {
    alpha: number;
    beta: number;
    gamma: number;
    r2: number;
    errorMedioPct: number;
    muestras: number;
  };
  resumen: {
    gastoTotalUsd: number;
    numViajes: number;
    meses: number;
    costoPromedioViajeUsd: number;
    gastoPromedioMesUsd: number;
    viajesPorMes: number;
  };
};
export const CONFIG_DEFAULT = configDefaultJson as ConfigOptimizacion & {
  depot: { lat: number; lon: number };
};
export const DATA_QUALITY_REPORT = dataQualityJson as {
  generadoEn: string;
  coordenadasNoParseables: string[];
  coordenadasCorregidasPorSigno: string[];
  pdvSinRutaAsignada: string[];
  pdvEnRutasSinCoordenada: string[];
  rutasNoReconocidasEnHistorico: string[];
};
export const PRODUCTOS_CONVERSION = productosConversionJson as ProductoConversion[];
/** PDV con hora límite de entrega (ej. "TUNG AMBATO PASEO SHOPPING": "09:00"). Editable en data/ventanas-horarias.json. */
export const VENTANAS_HORARIAS = ventanasHorariasJson as Record<string, string>;
/**
 * Costo ordinario de transporte por PDV (helado+queso+crema+insumos+envases), tomado de la
 * hoja "Costos ordinarios" de la tabla de aperturas/reaperturas/reubicaciones. Se usa como
 * respaldo del costo de viaje para PDV/rutas SIN precio pactado en el histórico de facturas.
 * Ver data/costos-ordinarios-aperturas.json.
 */
export const COSTOS_ORDINARIOS_APERTURAS = costosOrdinariosAperturasJson as Record<
  string,
  {
    zona: string;
    ruta: string;
    heladoUsd: number;
    quesoUsd: number;
    cremaUsd: number;
    insumosUsd: number;
    envasesUsd: number;
    totalUsd: number;
    totalRedondeadoUsd: number;
  }
>;
/**
 * Tarifa objetivo por PDV: la política de cobro de transporte ya diseñada con el
 * transportista (229 viajes reales, abr-2025 a jul-2026), a costo real por parada
 * facturable, con un tope de equidad de 2x el cobro actual — ningún PDV sube más del
 * doble de lo que paga hoy, así la actualización no perjudica al franquiciado. Reemplaza
 * el costo sugerido por PDV como fuente principal. Ver data/tarifa-objetivo-pdv.json.
 */
export const TARIFA_OBJETIVO_PDV = tarifaObjetivoPdvJson as Record<
  string,
  {
    ruta: string;
    cobroActualUsd: number;
    mes1Usd: number;
    mes2Usd: number;
    tarifaObjetivoUsd: number;
    minPedidoUsd: number | string | null;
    tipo: string | null;
  }
>;

const pdvById = new Map(PDV_MASTER.map((p) => [p.id, p]));

export function buscarPdv(id: string): Pdv | undefined {
  return pdvById.get(id.trim().toUpperCase().replace(/\s+/g, " "));
}

export function todosLosPdv(): Pdv[] {
  return PDV_MASTER;
}
