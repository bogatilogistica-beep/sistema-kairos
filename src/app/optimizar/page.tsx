"use client";

import { useState } from "react";
import PdvMap from "@/components/PdvMapClient";
import type { MapPoint, MapRoute } from "@/components/PdvMap";
import { parsePedidosSemanales, generarPlantillaXlsx, ResultadoParseo } from "@/lib/parseOrders";
import { useConfig } from "@/lib/useConfig";
import { ResultadoOptimizacion } from "@/lib/types";

const COLORES = ["#E8792B", "#4A2E1E", "#2E7D6B", "#8E44AD", "#1F6FB2", "#C0392B", "#B7950B", "#16A085"];

function descargarResultadosCsv(resultado: ResultadoOptimizacion) {
  const filas = [
    [
      "Camion",
      "Ruta",
      "Hora salida",
      "Orden",
      "PDV",
      "Provincia",
      "Peso (kg)",
      "Km desde anterior",
      "Llegada estimada",
      "Hora limite",
      "Costo sugerido (USD)",
    ],
  ];
  resultado.rutas.forEach((r) => {
    r.paradas.forEach((p) => {
      filas.push([
        r.camionAsignado,
        r.id,
        r.horaSalidaEstimada,
        String(p.ordenVisita),
        p.pdv.id,
        p.pdv.provincia,
        String(p.pesoKg),
        p.distanciaDesdeAnteriorKm.toFixed(1),
        p.horaLlegadaEstimada,
        p.horaLimite ?? "",
        p.costoAsignadoUsd.toFixed(2),
      ]);
    });
  });
  const csv = filas.map((fila) => fila.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rutas-optimizadas-${resultado.semana}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function descargarPlantilla() {
  const buffer = generarPlantillaXlsx();
  const blob = new Blob([buffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "plantilla-pedido-semanal-bogati.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}

interface ArchivoCargado {
  nombre: string;
  resultado: ResultadoParseo;
}

export default function OptimizarPage() {
  const { config, cargado } = useConfig();
  const [semana, setSemana] = useState(() => new Date().toISOString().slice(0, 10));
  const [archivos, setArchivos] = useState<ArchivoCargado[]>([]);
  const [resultado, setResultado] = useState<ResultadoOptimizacion | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Consolidado de todos los archivos cargados (helado, queso, crema, distintos
  // proveedores, etc.): se suman en un solo pedido de semana para optimizar de una vez.
  const itemsConsolidados = archivos.flatMap((a) => a.resultado.items);
  const erroresConsolidados = archivos.reduce((acc, a) => acc + a.resultado.errores.length, 0);
  const pdvUnicos = new Set(itemsConsolidados.map((i) => i.pdvId)).size;

  const onFiles = async (files: FileList) => {
    setError(null);
    setResultado(null);
    const nuevos: ArchivoCargado[] = [];
    for (const file of Array.from(files)) {
      const buffer = await file.arrayBuffer();
      const res = parsePedidosSemanales(buffer);
      nuevos.push({ nombre: file.name, resultado: res });
    }
    // si se vuelve a cargar un archivo con el mismo nombre, se reemplaza en vez de duplicar
    setArchivos((prev) => [...prev.filter((a) => !nuevos.some((n) => n.nombre === a.nombre)), ...nuevos]);
  };

  const quitarArchivo = (nombre: string) => {
    setArchivos((prev) => prev.filter((a) => a.nombre !== nombre));
    setResultado(null);
  };

  const optimizar = async () => {
    if (itemsConsolidados.length === 0) return;
    setCargando(true);
    setError(null);
    try {
      const res = await fetch("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: itemsConsolidados, semana, config }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error desconocido");
      setResultado(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  };

  const colorPorVehiculo = (vehiculoId: number) => COLORES[(vehiculoId - 1) % COLORES.length];

  const puntos: MapPoint[] = [];
  const rutas: MapRoute[] = [];
  if (resultado) {
    resultado.rutas.forEach((r) => {
      const color = colorPorVehiculo(r.vehiculoId);
      const track: [number, number][] = [[config.depot.lat, config.depot.lon]];
      r.paradas.forEach((p) => {
        puntos.push({
          lat: p.pdv.lat,
          lon: p.pdv.lon,
          label: `${r.camionAsignado} · ${p.ordenVisita}. ${p.pdv.id} — llega ${p.horaLlegadaEstimada} — ${p.pesoKg}kg — $${p.costoAsignadoUsd}`,
          color,
        });
        track.push([p.pdv.lat, p.pdv.lon]);
      });
      track.push([config.depot.lat, config.depot.lon]);
      rutas.push({ points: track, color });
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-bogati-brown">Optimizar semana</h1>
        <p className="text-bogati-brown/60 text-sm mt-1">
          Carga los archivos de pedido de la semana (helado, queso, crema, uno por proveedor si aplica) y calcula
          rutas óptimas por capacidad de camión y costos logísticos sugeridos por PDV, en un solo resultado
          consolidado.
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-bogati-brown/10 p-5 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="block">
            <span className="text-sm font-medium text-bogati-brown">Semana / fecha de referencia</span>
            <input
              type="text"
              value={semana}
              onChange={(e) => setSemana(e.target.value)}
              className="block mt-1 rounded-lg border border-bogati-brown/20 px-3 py-2 text-sm"
            />
          </label>
          <button
            onClick={descargarPlantilla}
            className="text-sm px-4 py-2 rounded-lg border border-bogati-brown/20 hover:bg-bogati-cream"
          >
            Descargar plantilla .xlsx
          </button>
          <label className="text-sm px-4 py-2 rounded-lg bg-bogati-brown text-white cursor-pointer hover:opacity-90">
            Cargar pedidos (varios .xlsx / .csv — helado, queso, crema, por proveedor, etc.)
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && e.target.files.length > 0 && onFiles(e.target.files)}
            />
          </label>
        </div>
        <p className="text-xs text-bogati-brown/50">
          Puedes cargar entre 1 y 15+ archivos a la vez (uno por categoría o proveedor). Todos se consolidan en un
          solo pedido de la semana antes de optimizar — no hace falta unirlos a mano.
        </p>

        {archivos.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wide text-bogati-brown/50 font-medium">
              {archivos.length} archivo(s) cargado(s)
            </div>
            <ul className="divide-y divide-bogati-brown/10 border border-bogati-brown/10 rounded-lg overflow-hidden">
              {archivos.map((a) => (
                <li key={a.nombre} className="flex items-center justify-between gap-3 px-3 py-2 text-sm bg-white">
                  <span className="truncate text-bogati-brown font-medium" title={a.nombre}>
                    {a.nombre}
                  </span>
                  <span className="flex items-center gap-3 shrink-0">
                    {a.resultado.formatoDetectado === "desconocido" ? (
                      <span className="text-red-700">⚠️ formato no reconocido</span>
                    ) : (
                      <span className="text-bogati-brown/60">
                        {a.resultado.items.length} líneas
                        {a.resultado.errores.length > 0 && (
                          <span className="text-amber-700"> · {a.resultado.errores.length} con problemas</span>
                        )}
                      </span>
                    )}
                    <button
                      onClick={() => quitarArchivo(a.nombre)}
                      className="text-bogati-brown/40 hover:text-red-700"
                      title="Quitar archivo"
                    >
                      ✕
                    </button>
                  </span>
                </li>
              ))}
            </ul>

            <div className="text-sm space-y-2 pt-1">
              <div className="flex gap-4">
                <span className="text-bogati-brown">
                  ✅ {itemsConsolidados.length} líneas de pedido válidas consolidadas ({pdvUnicos} PDV)
                </span>
                {erroresConsolidados > 0 && (
                  <span className="text-amber-700">⚠️ {erroresConsolidados} filas con problemas en total</span>
                )}
              </div>
              {erroresConsolidados > 0 && (
                <details className="text-xs text-amber-800">
                  <summary className="cursor-pointer">Ver filas con problemas</summary>
                  <ul className="list-disc list-inside mt-1 max-h-40 overflow-y-auto">
                    {archivos.flatMap((a) =>
                      a.resultado.errores.map((e, i) => (
                        <li key={`${a.nombre}-${i}`}>
                          {a.nombre} — fila {e.fila}: {e.motivo}
                        </li>
                      ))
                    )}
                  </ul>
                </details>
              )}
              <button
                onClick={optimizar}
                disabled={cargando || itemsConsolidados.length === 0 || !cargado}
                className="bg-bogati-orange text-white font-semibold px-5 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                {cargando ? "Calculando rutas…" : `Optimizar rutas de esta semana (${archivos.length} archivo(s))`}
              </button>
            </div>
          </div>
        )}

        {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>}
      </div>

      {resultado && (
        <>
          <div className="flex justify-end">
            <button
              onClick={() => descargarResultadosCsv(resultado)}
              className="text-sm px-4 py-2 rounded-lg border border-bogati-brown/20 hover:bg-bogati-cream"
            >
              Descargar resultados (.csv)
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              ["Peso total", `${resultado.totales.pesoTotalKg.toLocaleString("es-EC")} kg`],
              ["Viajes de la semana", String(resultado.totales.numViajes)],
              [
                "Camiones usados",
                `${resultado.totales.numCamionesUsados} / ${resultado.totales.numCamionesDisponibles}`,
              ],
              ["Distancia total", `${resultado.totales.distanciaTotalKm.toLocaleString("es-EC")} km`],
              ["Costo real de operación (consolidado)", `$${resultado.totales.costoTotalOptimizadoUsd.toFixed(2)}`],
            ].map(([label, value]) => (
              <div key={label} className="bg-white rounded-xl shadow-sm border border-bogati-brown/10 p-4">
                <div className="text-xs uppercase tracking-wide text-bogati-brown/60 font-medium">{label}</div>
                <div className="text-xl font-bold text-bogati-brown mt-1">{value}</div>
              </div>
            ))}
          </div>

          {resultado.totales.camionesSobrecargados > 0 && (
            <div className="bg-red-50 border border-red-300 rounded-xl p-4 text-sm text-red-900">
              ⚠️ <strong>{resultado.totales.camionesSobrecargados}</strong> de {resultado.totales.numCamionesDisponibles}{" "}
              camiones supera las {config.horasDisponiblesPorCamionSemana}h disponibles en la semana con la carga de
              viajes asignada. Con esta cantidad de pedido y flota, no alcanza el tiempo para cubrir todo en la
              semana — revisa abajo qué camión(es) están sobrecargados, considera adelantar/posponer pedidos de menor
              prioridad, o contratar un viaje adicional puntual.
            </div>
          )}

          <div>
            <h2 className="text-sm font-semibold text-bogati-brown/70 uppercase tracking-wide mb-2">
              Ahorro por consolidar rutas (vs. despachar cada PDV por separado)
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-white rounded-xl shadow-sm border border-bogati-brown/10 p-4">
                <div className="text-xs uppercase tracking-wide text-bogati-brown/60 font-medium">
                  Costo si cada PDV va solo
                </div>
                <div className="text-xl font-bold text-bogati-brown mt-1">
                  ${resultado.totales.costoSinConsolidarUsd.toFixed(2)}
                </div>
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-bogati-brown/10 p-4">
                <div className="text-xs uppercase tracking-wide text-bogati-brown/60 font-medium">Costo consolidado</div>
                <div className="text-xl font-bold text-bogati-brown mt-1">
                  ${resultado.totales.costoTotalOptimizadoUsd.toFixed(2)}
                </div>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                <div className="text-xs uppercase tracking-wide text-green-800 font-medium">Ahorro por consolidar</div>
                <div className="text-xl font-bold text-green-800 mt-1">
                  ${resultado.totales.ahorroPorConsolidacionUsd.toFixed(2)} ({resultado.totales.ahorroPorConsolidacionPct}%)
                </div>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-bogati-brown/70 uppercase tracking-wide mb-2">
              Referencia: tarifa actual cobrada al PDV
            </h2>
            <p className="text-xs text-bogati-brown/50 mb-2">
              La tarifa fija de COBRO DE TRANSPORTE es lo que hoy se factura al PDV, no necesariamente el costo real
              de operar la ruta. Compararla contra el costo real de operación ayuda a ver si algún grupo de PDV está
              sub-facturado frente a lo que realmente cuesta llevarles el pedido.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-white rounded-xl shadow-sm border border-bogati-brown/10 p-4">
                <div className="text-xs uppercase tracking-wide text-bogati-brown/60 font-medium">
                  Tarifa actual cobrada al PDV
                </div>
                <div className="text-xl font-bold text-bogati-brown mt-1">
                  ${resultado.totales.costoTotalActualUsd.toFixed(2)}
                </div>
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-bogati-brown/10 p-4">
                <div className="text-xs uppercase tracking-wide text-bogati-brown/60 font-medium">
                  Costo real de operación
                </div>
                <div className="text-xl font-bold text-bogati-brown mt-1">
                  ${resultado.totales.costoTotalOptimizadoUsd.toFixed(2)}
                </div>
              </div>
              <div
                className={`rounded-xl p-4 border ${
                  resultado.totales.ahorroTotalUsd >= 0
                    ? "bg-green-50 border-green-200"
                    : "bg-amber-50 border-amber-300"
                }`}
              >
                <div
                  className={`text-xs uppercase tracking-wide font-medium ${
                    resultado.totales.ahorroTotalUsd >= 0 ? "text-green-800" : "text-amber-900"
                  }`}
                >
                  {resultado.totales.ahorroTotalUsd >= 0 ? "Margen sobre la tarifa actual" : "Posible sub-facturación"}
                </div>
                <div
                  className={`text-xl font-bold mt-1 ${
                    resultado.totales.ahorroTotalUsd >= 0 ? "text-green-800" : "text-amber-900"
                  }`}
                >
                  ${Math.abs(resultado.totales.ahorroTotalUsd).toFixed(2)} ({Math.abs(resultado.totales.ahorroPct)}%)
                </div>
              </div>
            </div>
          </div>

          {(resultado.pdvSinCoordenadaValida.length > 0 || resultado.pdvSinPedido.length > 0) && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 text-xs text-amber-900">
              {resultado.pdvSinCoordenadaValida.length > 0 && (
                <div>
                  ⚠️ {resultado.pdvSinCoordenadaValida.length} PDV en esta ruta usan una coordenada aproximada
                  (ver /red).
                </div>
              )}
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm border border-bogati-brown/10 p-3">
            <PdvMap
              points={[
                { lat: config.depot.lat, lon: config.depot.lon, label: "Parque Industrial Ambato (depósito)", color: "#000" },
                ...puntos,
              ]}
              routes={rutas}
              zoom={6}
            />
          </div>

          <div className="space-y-6">
            {resultado.flota.map((camion) => (
              <div key={camion.vehiculoId} className="space-y-3">
                <div
                  className={`rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-2 border-2 ${
                    camion.sobrecargado ? "border-red-400 bg-red-50" : "border-transparent"
                  }`}
                  style={{ backgroundColor: camion.sobrecargado ? undefined : `${colorPorVehiculo(camion.vehiculoId)}15` }}
                >
                  <div className="font-bold text-bogati-brown flex items-center gap-2">
                    <span
                      className="inline-block w-3 h-3 rounded-full"
                      style={{ backgroundColor: colorPorVehiculo(camion.vehiculoId) }}
                    />
                    Camión {camion.vehiculoId}
                    {camion.sobrecargado && <span className="text-red-700 text-xs font-semibold">⚠️ sobrecargado</span>}
                  </div>
                  <div className="text-sm text-bogati-brown/70 flex gap-4">
                    <span>{camion.viajes.length} viajes esta semana</span>
                    <span>{camion.pesoTotalKg} kg</span>
                    <span>{camion.distanciaTotalKm} km</span>
                    <span className={camion.sobrecargado ? "font-semibold text-red-700" : ""}>
                      {camion.horasTotales}h / {config.horasDisponiblesPorCamionSemana}h
                    </span>
                  </div>
                </div>

                {camion.viajes.map((r) => (
                  <div key={r.id} className="bg-white rounded-xl shadow-sm border border-bogati-brown/10 overflow-hidden ml-4">
                    <div
                      className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-white"
                      style={{ backgroundColor: colorPorVehiculo(r.vehiculoId) }}
                    >
                      <div className="font-semibold text-sm">
                        {r.id} · sale {r.horaSalidaEstimada}
                      </div>
                      <div className="text-xs flex gap-3">
                        <span>{r.paradas.length} paradas</span>
                        <span>
                          {r.pesoTotalKg} kg ({r.capacidadUtilizadaPct}% capacidad)
                        </span>
                        <span>{r.distanciaTotalKm} km</span>
                        <span title={`Peso del árbol de expansión mínima del grafo: ${r.pesoMstKm} km`}>
                          {r.eficienciaRecorridoPct}% eficiencia de grafo
                        </span>
                        <span>{Math.round(r.duracionEstimadaMin / 60)} h</span>
                        <span title="Lo que Bogati le paga al transportista por este viaje">
                          ${r.costoTotalViajeUsd.toFixed(2)} transportista
                        </span>
                      </div>
                    </div>
                    {r.alertaHorario && (
                      <div className="bg-red-50 border-b border-red-200 text-red-800 text-xs px-4 py-2">
                        ⚠️ {r.alertaHorario}
                      </div>
                    )}
                    {r.cargaBajoMinimoTransportista && (
                      <div className="bg-amber-50 border-b border-amber-200 text-amber-800 text-xs px-4 py-2">
                        ⚠️ {r.detalleMinimoCarga}
                      </div>
                    )}
                    <table className="w-full text-sm">
                      <thead className="bg-bogati-cream text-bogati-brown/70 text-xs uppercase">
                        <tr>
                          <th className="text-left px-3 py-2">#</th>
                          <th className="text-left px-3 py-2">PDV</th>
                          <th className="text-right px-3 py-2">Peso</th>
                          <th className="text-right px-3 py-2">Km desde anterior</th>
                          <th className="text-right px-3 py-2">Llegada estimada</th>
                          <th className="text-right px-3 py-2" title="Lo que se le cobraría al punto de venta por este despacho — no tiene que sumar igual al costo del transportista arriba">
                            Costo sugerido a PDV
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.paradas.map((p) => (
                          <tr key={p.pdv.id} className="border-t border-bogati-brown/5">
                            <td className="px-3 py-1.5">{p.ordenVisita}</td>
                            <td className="px-3 py-1.5 font-medium text-bogati-brown">{p.pdv.id}</td>
                            <td className="px-3 py-1.5 text-right">{p.pesoKg} kg</td>
                            <td className="px-3 py-1.5 text-right">{p.distanciaDesdeAnteriorKm.toFixed(1)} km</td>
                            <td
                              className={`px-3 py-1.5 text-right ${p.incumpleVentana ? "text-red-700 font-semibold" : ""}`}
                            >
                              {p.horaLlegadaEstimada}
                              {p.horaLimite && ` (límite ${p.horaLimite})`}
                            </td>
                            <td className="px-3 py-1.5 text-right">${p.costoAsignadoUsd.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-bogati-brown/15 bg-bogati-cream/60 text-xs">
                          <td colSpan={5} className="px-3 py-1.5 text-right text-bogati-brown/70">
                            Total sugerido a PDV vs. costo real al transportista:
                          </td>
                          <td className="px-3 py-1.5 text-right font-semibold text-bogati-brown">
                            ${r.paradas.reduce((a, p) => a + p.costoAsignadoUsd, 0).toFixed(2)}
                            <span className="font-normal text-bogati-brown/50"> / ${r.costoTotalViajeUsd.toFixed(2)}</span>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
