# Bogati Rutas

Plataforma de optimización logística para la distribución semanal de **HELADO, QUESO y
CREMA** a los puntos de venta (PDV) de Bogati Sabor Adictivo. Calcula rutas de camión
óptimas por capacidad y geografía, y sugiere el costo logístico justo a cobrar a cada PDV.

Construida para el Concurso Interno de IA de Bogati.

## Qué hace

1. **Carga de pedido semanal** (`/optimizar`): subes un Excel/CSV con el pedido de la
   semana (PDV, categoría, producto, cantidad, unidad).
2. **Motor de rutas**: arma cada carga de camión por PDV más cercano real (no por
   provincia ni ninguna división administrativa — dos PDV de provincias distintas pero
   vecinos sí pueden compartir camión), respetando la capacidad máxima. Cada carga se
   modela como un grafo ponderado (nodos = PDV + planta, aristas = distancia real de
   carretera) y se secuencia con árbol de expansión mínima + 2-opt.
3. **Flota fija de N camiones**: los viajes ya armados se reparten entre los camiones
   reales disponibles en la semana (5 por defecto) procurando que cada camión trabaje una
   zona geográfica contigua, balanceando horas solo cuando hace falta para no sobrecargar
   ninguno.
4. **Costeo**: calcula el costo real del viaje (`alpha + beta·kg + gamma·km`), calibrado
   por regresión contra 262 viajes reales de `TRANSPORTE CONTROL DE FACTURAS`, y lo
   prorratea entre los PDV de la ruta combinando su participación en peso y en distancia
   marginal (cuánto alargan la ruta). Lo compara contra la tarifa fija actual por PDV.
5. **Panel** (`/`), **Red de PDV** (`/red` — maestro + reporte de calidad de datos) y
   **Configuración** (`/config` — capacidad de camión, número de camiones, fórmula de
   costo, depósito).

## Arquitectura

- Next.js 15 (App Router) + TypeScript + Tailwind, desplegable en Vercel sin base de
  datos: los datos maestros viven como JSON generados en `/data`.
- `scripts/generar-datos.ts`: pipeline que limpia y cruza los archivos fuente de Bogati
  (coordenadas, rutas, tarifas, histórico de costos) hacia los JSON de `/data`. Se corre
  una sola vez (o cuando cambien los archivos fuente) con `npm run generar-datos`; los
  archivos fuente originales viven en `/source-data-raw` y **nunca se suben al repo**
  (contienen datos operativos sensibles).
- `src/lib/`: el motor en sí — `clustering.ts` (agrupamiento por PDV más cercano y
  capacidad), `grafo.ts` (árbol de expansión mínima + Dijkstra), `tsp.ts` (secuenciación
  de ruta), `distance.ts` (distancias: caché precalculada → Google Maps/Mapbox si hay API
  key → Haversine), `distanceCache.ts` (lectura de la caché de distancias reales),
  `fleet.ts` (reparto de viajes entre los camiones disponibles), `costModel.ts` (fórmula
  de costo y prorrateo), `optimizer.ts` (orquestador), `productWeights.ts` (conversión de
  unidades a kg).
- `scripts/precalcular-distancias.ts`: calcula UNA VEZ la distancia real de carretera
  entre todos los pares de PDV + planta (Google Distance Matrix) y la guarda en
  `data/distancias-cache.json` (`npm run precalcular-distancias`, necesita
  `GOOGLE_MAPS_API_KEY`). Como la ubicación de los PDV no cambia semana a semana, el motor
  de rutas usa esta caché para decidir el agrupamiento por cercanía sin volver a llamar a
  la API — sigue funcionando con distancias reales aunque la API key se revoque después,
  para cualquier PDV que ya existiera cuando se generó la caché. Un PDV nuevo (no
  presente en la caché) cae a Haversine + factor vial hasta que se vuelva a correr el
  script con una API key válida.
- `/api/optimize`: único endpoint de servidor; recibe el pedido parseado y la
  configuración, corre el motor y devuelve las rutas optimizadas.

## Desarrollo local

```bash
npm install
npm run generar-datos   # solo si cambiaron los archivos fuente en /source-data-raw
npm run dev
```

## Variables de entorno (opcionales)

Ver `.env.example`. Sin ninguna, las distancias se calculan con coordenadas GPS
(Haversine + factor vial), sin costo. Con `GOOGLE_MAPS_API_KEY` o `MAPBOX_TOKEN`, se
usan distancias y tiempos de manejo reales automáticamente.

## Notas de metodología (para la evaluación del comité)

- **Capacidad de camión**: 3,500 kg por defecto (confirmado por el equipo), ajustable en
  `/config`.
- **Flota**: 100% tercerizada por viaje (confirmado), por eso el modelo de costo es "costo
  de viaje" y no "costo operativo de flota propia".
- **Fórmula de costo**: calibrada por regresión lineal (mínimos cuadrados) contra el
  histórico real; ver el R² y el número de muestras en `/config`.
- **Distancia de ruta histórica**: como el histórico no registra la distancia recorrida
  por viaje, se estima resolviendo el TSP de los PDV asignados a esa ruta en
  `RUTAS DE TRANSPORTE 2026`, usado únicamente para calibrar la fórmula de costo.
- Ver `data/data-quality-report.json` (o la pestaña **Red de PDV**) para las
  inconsistencias detectadas en los archivos fuente (coordenadas corregidas, PDV sin ruta
  asignada, etc.).
