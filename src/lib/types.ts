// Tipos centrales del motor de rutas y costos logísticos Bogati

export type Categoria = "HELADO" | "QUESO" | "CREMA";

export interface Pdv {
  id: string; // nombre normalizado, usado como clave en todos los archivos (ej. "AZUY CUENCA 9 DE OCTUBRE")
  nombre: string;
  sector: string;
  direccion: string;
  provincia: string;
  zona: string;
  rutaActual: string; // código de ruta actual (ej. "CUE", "BOLGY")
  lat: number;
  lon: number;
  coordenadaValidada: boolean; // false si la coordenada original venía corrupta y fue estimada/omitida
  frecuenciaHelado: string; // ej. "QUINCENAL", "C/15", "SEMANAL"
  frecuenciaQuesoCrema: string;
  estatus: "ACTIVO" | "CERRADO" | string;
}

export interface PedidoItem {
  pdvId: string;
  categoria: Categoria;
  producto: string;
  cantidad: number;
  unidad: string; // "LT", "KG", "UNID", "TACHO_9KG", "TACHO_3.5KG", etc.
  pesoKg: number; // ya convertido a kg usando la tabla de conversión
}

export interface PedidoSemanal {
  semana: string; // ISO week label, ej. "2026-W07"
  items: PedidoItem[];
}

export interface CargaPdv {
  pdv: Pdv;
  pesoTotalKg: number;
  categorias: Categoria[];
  items: PedidoItem[];
}

export interface Camion {
  id: string;
  capacidadKg: number;
}

export interface ParadaRuta {
  pdv: Pdv;
  ordenVisita: number;
  pesoKg: number;
  categorias: Categoria[]; // qué categorías (helado/queso/crema) se despachan a este PDV esta semana
  distanciaDesdeAnteriorKm: number;
  distanciaMarginalKm: number; // costo de insertar esta parada en la secuencia óptima
  costoAsignadoUsd: number;
  horaLlegadaEstimada: string; // "HH:MM"
  horaLimite: string | null; // "HH:MM" si el PDV tiene ventana horaria, null si no
  incumpleVentana: boolean;
}

export interface RutaOptimizada {
  id: string;
  camionAsignado: string;
  vehiculoId: number; // 1..numeroCamionesDisponibles: a qué camión físico se asignó este viaje
  paradas: ParadaRuta[];
  pesoTotalKg: number;
  capacidadUtilizadaPct: number;
  distanciaTotalKm: number;
  /** Peso del árbol de expansión mínima del grafo de distancias del clúster (cota inferior teórica de conectividad). */
  pesoMstKm: number;
  /** pesoMstKm / distanciaTotalKm, qué tan cerca quedó la ruta final del óptimo teórico del grafo. */
  eficienciaRecorridoPct: number;
  duracionEstimadaMin: number;
  costoTotalViajeUsd: number;
  costoActualEstimadoUsd: number; // usando tarifas fijas actuales (COBRO DE TRANSPORTE) como referencia "antes"
  ahorroUsd: number;
  proveedorDistancia: "haversine" | "google" | "mapbox" | "cache" | "osrm";
  horaSalidaEstimada: string; // "HH:MM": hora en que el camión debe salir de planta
  alertaHorario: string | null; // mensaje si no alcanza a cumplir alguna ventana horaria
  /** true si algún producto del viaje no llega a la cantidad mínima del transportista (config.minimosCarga). */
  cargaBajoMinimoTransportista: boolean;
  /** Detalle legible de qué producto(s) están bajo el mínimo, o null si ninguno. */
  detalleMinimoCarga: string | null;
}

export interface CamionSemana {
  vehiculoId: number;
  viajes: RutaOptimizada[];
  pesoTotalKg: number;
  distanciaTotalKm: number;
  horasTotales: number;
  sobrecargado: boolean; // horasTotales supera las horas disponibles configuradas para la semana
}

export interface ResultadoOptimizacion {
  semana: string;
  rutas: RutaOptimizada[];
  flota: CamionSemana[];
  pdvSinPedido: string[];
  pdvSinCoordenadaValida: string[];
  totales: {
    pesoTotalKg: number;
    numViajes: number;
    numCamionesDisponibles: number;
    numCamionesUsados: number;
    camionesSobrecargados: number;
    costoTotalOptimizadoUsd: number;
    /** Costo actual: suma de la tarifa fija que hoy se cobra a cada PDV (COBRO DE TRANSPORTE). */
    costoTotalActualUsd: number;
    ahorroTotalUsd: number;
    ahorroPct: number;
    /** Costo si cada PDV se despachara solo, sin compartir camión con nadie (línea base real de operación). */
    costoSinConsolidarUsd: number;
    ahorroPorConsolidacionUsd: number;
    ahorroPorConsolidacionPct: number;
    distanciaTotalKm: number;
    /** Llenado promedio de los camiones despachados (%). Como se paga por despacho, esta es la métrica que mueve la factura. */
    llenadoPromedioPct: number;
    /** Despachos mínimos que exigiría la carga total si los camiones fueran al 100%. */
    viajesMinimosPorCapacidad: number;
    /** numViajes - viajesMinimosPorCapacidad: despachos que sobran por ir con camiones a medio llenar. */
    despachosEvitables: number;
    /** Rutas flacas que se fusionaron en un mismo despacho, con el ahorro de cada fusión. */
    fusionesAplicadas: {
      rutaA: string;
      rutaB: string;
      pesoTotalKg: number;
      llenadoPct: number;
      separacionKm: number;
      costoSeparadoUsd: number;
      costoFusionadoUsd: number;
      ahorroUsd: number;
    }[];
    ahorroPorFusionUsd: number;
    /** Despachos cuya última entrega cae después de la hora tope: el producto no puede pernoctar en el camión. */
    despachosFueraDeJornada: { id: string; finEntregas: string; paradas: number }[];
    /** Despachos que van con algún producto por debajo de la cantidad mínima del transportista. */
    despachosBajoMinimo: number;
  };
}

export interface ConfigOptimizacion {
  capacidadCamionKg: number;
  numeroCamionesDisponibles: number; // flota real disponible por semana (tercerizada)
  horasDisponiblesPorCamionSemana: number; // jornada semanal máxima razonable por camión (viajes + carga/descarga)
  radioMaximoViajeKm: number; // radio máx. desde el centroide del viaje: prioriza compacidad geográfica sobre llenar el camión al 100%
  horaAperturaGeneral: string; // "HH:MM": hora desde la que los PDV sin ventana especial reciben pedido
  horaMasTempranoCarga: string; // "HH:MM": hora más temprana en que un camión puede empezar a cargar en planta
  horaMasTardeCarga: string; // "HH:MM": hora más tarde en que un camión puede empezar a cargar en planta
  duracionCargaMin: number; // minutos promedio que toma cargar un camión antes de salir
  factorCircuidadVial: number; // multiplica distancia línea recta para aproximar distancia real de carretera
  velocidadPromedioKmh: number;
  minutosPorParada: number;
  costoFormula: {
    alpha: number; // costo fijo base por viaje (USD)
    beta: number; // USD por kg transportado
    gamma: number; // USD por km recorrido
  };
  pesoAsignacionPct: number; // 0-1, ponderación del criterio "peso" vs "distancia marginal" al prorratear costo por PDV
  /**
   * "ruta" (por defecto): un despacho = una ruta pactada. Es lo correcto mientras el
   * transportista cobre precio fijo por ruta, porque un viaje que mezcla rutas paga todas.
   * "cercania": agrupamiento geográfico ignorando rutas. Solo conviene si se pasa a tarifa por km.
   */
  modoAgrupamiento?: "ruta" | "cercania";
  /** false desactiva la fusión de despachos flacos. Por defecto está activa. */
  consolidarDespachos?: boolean;
  /** Distancia máxima entre dos rutas para considerarlas vecinas y fusionables (km). */
  separacionMaximaKm?: number;
  /** Llenado (%) a partir del cual un despacho ya no se considera "flaco" y no se fusiona. */
  llenadoObjetivoPct?: number;
  /** "HH:MM" hora tope para terminar de entregar. El helado no puede pernoctar en el camión. */
  horaFinEntregas?: string;
  /**
   * Cantidad mínima de carga por producto para el "pago mínimo" del transportista
   * (tabla de fletes referenciales de aperturas). Un viaje por debajo de estos mínimos:
   *  - se marca con una alerta (cargaBajoMinimoTransportista en RutaOptimizada), y
   *  - si la ruta no tiene precio pactado, usa el flete referencial de aperturas en vez
   *    de la fórmula lineal de respaldo (que sobreestima sistemáticamente).
   */
  minimosCarga: {
    heladoTachos: number;
    litrosPorTachoHelado: number;
    quesoUnidades: number;
    kgPorUnidadQueso: number;
    cremaLitros: number;
  };
}
