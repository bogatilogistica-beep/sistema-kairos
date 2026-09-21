import { PDV_MASTER, DATA_QUALITY_REPORT, COBRO_ACTUAL } from "@/lib/pdvData";

export default function RedPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-bogati-brown">Red de puntos de venta</h1>
        <p className="text-bogati-brown/60 text-sm mt-1">
          Maestro de {PDV_MASTER.length} PDV activos, generado desde MATRIZ DE UBICACIONES BOGATI + RUTAS DE
          TRANSPORTE 2026.
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-bogati-brown/10 p-4 space-y-3">
        <h2 className="font-semibold text-bogati-brown">Reporte de calidad de datos</h2>
        <div className="grid md:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="font-medium text-bogati-brown">
              Coordenadas no reconocidas ({DATA_QUALITY_REPORT.coordenadasNoParseables.length})
            </div>
            <p className="text-bogati-brown/60 text-xs mb-1">
              Se usó la coordenada del PDV activo más cercano en la misma ciudad como aproximación temporal.
            </p>
            <ul className="list-disc list-inside text-bogati-brown/80">
              {DATA_QUALITY_REPORT.coordenadasNoParseables.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="font-medium text-bogati-brown">
              Coordenadas corregidas automáticamente ({DATA_QUALITY_REPORT.coordenadasCorregidasPorSigno.length})
            </div>
            <p className="text-bogati-brown/60 text-xs mb-1">
              Se detectó y corrigió un error de signo (norte/sur) comparando contra la planta y contra PDV
              vecinos. Verificar en Google Maps.
            </p>
            <ul className="list-disc list-inside text-bogati-brown/80 max-h-32 overflow-y-auto">
              {DATA_QUALITY_REPORT.coordenadasCorregidasPorSigno.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="font-medium text-bogati-brown">
              Sin ruta asignada en RUTAS DE TRANSPORTE 2026 ({DATA_QUALITY_REPORT.pdvSinRutaAsignada.length})
            </div>
            <ul className="list-disc list-inside text-bogati-brown/80">
              {DATA_QUALITY_REPORT.pdvSinRutaAsignada.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="font-medium text-bogati-brown">
              Rutas del histórico no reconocidas ({DATA_QUALITY_REPORT.rutasNoReconocidasEnHistorico.length})
            </div>
            <ul className="list-disc list-inside text-bogati-brown/80">
              {DATA_QUALITY_REPORT.rutasNoReconocidasEnHistorico.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-bogati-brown/10 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-bogati-cream text-bogati-brown/70 text-xs uppercase">
            <tr>
              <th className="text-left px-3 py-2">PDV</th>
              <th className="text-left px-3 py-2">Provincia</th>
              <th className="text-left px-3 py-2">Zona</th>
              <th className="text-left px-3 py-2">Ruta actual</th>
              <th className="text-left px-3 py-2">Frec. helado</th>
              <th className="text-left px-3 py-2">Frec. queso/crema</th>
              <th className="text-right px-3 py-2">Tarifa actual</th>
              <th className="text-center px-3 py-2">Coord. verificada</th>
            </tr>
          </thead>
          <tbody>
            {PDV_MASTER.map((p) => (
              <tr key={p.id} className="border-t border-bogati-brown/5 hover:bg-bogati-cream/50">
                <td className="px-3 py-1.5 font-medium text-bogati-brown">{p.id}</td>
                <td className="px-3 py-1.5">{p.provincia}</td>
                <td className="px-3 py-1.5">{p.zona}</td>
                <td className="px-3 py-1.5">{p.rutaActual}</td>
                <td className="px-3 py-1.5">{p.frecuenciaHelado}</td>
                <td className="px-3 py-1.5">{p.frecuenciaQuesoCrema}</td>
                <td className="px-3 py-1.5 text-right">${(COBRO_ACTUAL[p.id] ?? 0).toFixed(2)}</td>
                <td className="px-3 py-1.5 text-center">{p.coordenadaValidada ? "✅" : "⚠️"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
