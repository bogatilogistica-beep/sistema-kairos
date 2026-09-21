import Link from "next/link";
import PdvMap from "@/components/PdvMapClient";
import { PDV_MASTER, RUTAS_ACTUALES, DATA_QUALITY_REPORT, COBRO_ACTUAL } from "@/lib/pdvData";

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-bogati-brown/10 p-4">
      <div className="text-xs uppercase tracking-wide text-bogati-brown/60 font-medium">{label}</div>
      <div className="text-2xl font-bold text-bogati-brown mt-1">{value}</div>
      {sub && <div className="text-xs text-bogati-brown/50 mt-1">{sub}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const provincias = new Set(PDV_MASTER.map((p) => p.provincia));
  const tarifaMensualActual = PDV_MASTER.reduce((acc, p) => {
    const tarifa = COBRO_ACTUAL[p.id] ?? 0;
    // aproximación de visitas/mes según frecuencia declarada
    const visitasMes =
      p.frecuenciaQuesoCrema.includes("SEMANAL") ? 4 : p.frecuenciaQuesoCrema.includes("QUINCENAL") ? 2 : 1;
    return acc + tarifa * visitasMes;
  }, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-bogati-brown">Panel logístico</h1>
          <p className="text-bogati-brown/60 text-sm mt-1">
            Red actual de distribución de HELADO, QUESO y CREMA — {PDV_MASTER.length} puntos de venta activos.
          </p>
        </div>
        <Link
          href="/optimizar"
          className="bg-bogati-orange text-white font-semibold px-5 py-2.5 rounded-lg hover:opacity-90 transition-opacity"
        >
          Cargar pedido de la semana →
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Puntos de venta activos" value={String(PDV_MASTER.length)} />
        <KpiCard label="Rutas operativas" value={String(Object.keys(RUTAS_ACTUALES).length)} />
        <KpiCard label="Provincias cubiertas" value={String(provincias.size)} />
        <KpiCard
          label="Costo transporte actual (referencia)"
          value={`$${tarifaMensualActual.toLocaleString("es-EC", { maximumFractionDigits: 0 })}/mes`}
          sub="Según tarifas fijas actuales y frecuencia declarada"
        />
      </div>

      {(DATA_QUALITY_REPORT.coordenadasNoParseables.length > 0 ||
        DATA_QUALITY_REPORT.pdvSinRutaAsignada.length > 0) && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 text-sm text-amber-900">
          <strong>Aviso de calidad de datos:</strong> hay {DATA_QUALITY_REPORT.coordenadasNoParseables.length}{" "}
          PDV con coordenadas no reconocidas y {DATA_QUALITY_REPORT.pdvSinRutaAsignada.length} sin ruta asignada
          en el archivo fuente. Revisa el detalle en{" "}
          <Link href="/red" className="underline font-medium">
            Red de PDV
          </Link>
          .
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-bogati-brown/10 p-3">
        <PdvMap
          points={PDV_MASTER.map((p) => ({ lat: p.lat, lon: p.lon, label: `${p.id} — ${p.rutaActual}` }))}
          zoom={7}
        />
      </div>
    </div>
  );
}
