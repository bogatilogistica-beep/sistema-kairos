"use client";

import { useConfig } from "@/lib/useConfig";
import { COSTOS_HISTORICOS } from "@/lib/pdvData";

function Campo({
  label,
  value,
  onChange,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-bogati-brown">{label}</span>
      <div className="flex items-center gap-2 mt-1">
        <input
          type="number"
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full rounded-lg border border-bogati-brown/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-bogati-orange"
        />
        {suffix && <span className="text-xs text-bogati-brown/50 whitespace-nowrap">{suffix}</span>}
      </div>
    </label>
  );
}

function CampoHora({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-bogati-brown">{label}</span>
      <div className="flex items-center gap-2 mt-1">
        <input
          type="time"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-lg border border-bogati-brown/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-bogati-orange"
        />
        {suffix && <span className="text-xs text-bogati-brown/50 whitespace-nowrap">{suffix}</span>}
      </div>
    </label>
  );
}

export default function ConfigPage() {
  const { config, actualizar, resetear, cargado } = useConfig();

  if (!cargado) return null;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-bogati-brown">Configuración del motor de rutas</h1>
        <p className="text-bogati-brown/60 text-sm mt-1">
          Estos parámetros se guardan en este navegador y se usan cada vez que optimizas una semana. Los valores
          por defecto se calibraron con el histórico real de Bogati (R² ={" "}
          {COSTOS_HISTORICOS.regresion.r2.toFixed(2)} sobre {COSTOS_HISTORICOS.regresion.muestras} viajes).
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-bogati-brown/10 p-5 space-y-4">
        <h2 className="font-semibold text-bogati-brown">Flota</h2>
        <p className="text-xs text-bogati-brown/50">
          Bogati trabaja con una flota tercerizada fija por semana. El motor arma primero cada viaje agrupando
          siempre el PDV más cercano real (sin importar provincia), y luego reparte los viajes entre los camiones
          disponibles procurando que cada uno trabaje una zona geográfica contigua.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Campo
            label="Camiones disponibles por semana"
            value={config.numeroCamionesDisponibles}
            onChange={(v) => actualizar({ numeroCamionesDisponibles: Math.max(1, Math.round(v)) })}
            step={1}
            suffix="camiones"
          />
          <Campo
            label="Capacidad máxima por camión"
            value={config.capacidadCamionKg}
            onChange={(v) => actualizar({ capacidadCamionKg: v })}
            step={100}
            suffix="kg"
          />
        </div>
        <Campo
          label="Horas disponibles por camión en la semana"
          value={config.horasDisponiblesPorCamionSemana}
          onChange={(v) => actualizar({ horasDisponiblesPorCamionSemana: v })}
          step={1}
          suffix="horas (viajes + carga/descarga)"
        />
        <Campo
          label="Radio máximo de trabajo por viaje"
          value={config.radioMaximoViajeKm}
          onChange={(v) => actualizar({ radioMaximoViajeKm: v })}
          step={10}
          suffix="km — un camión se cierra aunque no esté lleno antes de cruzar a otra región"
        />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-bogati-brown/10 p-5 space-y-4">
        <h2 className="font-semibold text-bogati-brown">Horarios</h2>
        <p className="text-xs text-bogati-brown/50">
          Los PDV con ventana horaria propia (ej. Paseo Shopping hasta las 9am, Mall de los Andes hasta las 10am)
          se configuran en <code>data/ventanas-horarias.json</code>. El resto de PDV recibe desde la hora general de
          abajo. El motor calcula la hora de salida de cada camión hacia atrás desde la ventana más exigente que
          lleve ese viaje, sin salir antes de que la planta pueda tenerlo cargado.
        </p>
        <CampoHora
          label="Hora general de recepción"
          value={config.horaAperturaGeneral}
          onChange={(v) => actualizar({ horaAperturaGeneral: v })}
          suffix="PDV sin ventana horaria propia"
        />
        <div className="grid grid-cols-3 gap-4">
          <CampoHora
            label="Planta abre para cargar"
            value={config.horaMasTempranoCarga}
            onChange={(v) => actualizar({ horaMasTempranoCarga: v })}
          />
          <CampoHora
            label="Planta cierra para cargar"
            value={config.horaMasTardeCarga}
            onChange={(v) => actualizar({ horaMasTardeCarga: v })}
          />
          <Campo
            label="Duración promedio de carga"
            value={config.duracionCargaMin}
            onChange={(v) => actualizar({ duracionCargaMin: v })}
            step={5}
            suffix="minutos"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-bogati-brown/10 p-5 space-y-4">
        <h2 className="font-semibold text-bogati-brown">Distancias y tiempos</h2>
        <p className="text-xs text-bogati-brown/50">
          Si configuras GOOGLE_MAPS_API_KEY o MAPBOX_TOKEN en Vercel, estos dos parámetros dejan de usarse (se
          reemplazan por distancias y tiempos reales del proveedor).
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Campo
            label="Factor de circuidad vial"
            value={config.factorCircuidadVial}
            onChange={(v) => actualizar({ factorCircuidadVial: v })}
            step={0.05}
            suffix="× línea recta"
          />
          <Campo
            label="Velocidad promedio"
            value={config.velocidadPromedioKmh}
            onChange={(v) => actualizar({ velocidadPromedioKmh: v })}
            step={1}
            suffix="km/h"
          />
        </div>
        <Campo
          label="Tiempo de servicio por parada"
          value={config.minutosPorParada}
          onChange={(v) => actualizar({ minutosPorParada: v })}
          step={1}
          suffix="minutos"
        />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-bogati-brown/10 p-5 space-y-4">
        <h2 className="font-semibold text-bogati-brown">Fórmula de costo del viaje</h2>
        <p className="text-xs text-bogati-brown/50">
          costo = alpha + beta × kg transportados + gamma × km recorridos. Calibrado por regresión contra 262
          viajes reales de TRANSPORTE CONTROL DE FACTURAS.
        </p>
        <div className="grid grid-cols-3 gap-4">
          <Campo
            label="Alpha (fijo por viaje)"
            value={config.costoFormula.alpha}
            onChange={(v) => actualizar({ costoFormula: { ...config.costoFormula, alpha: v } })}
            step={0.5}
            suffix="USD"
          />
          <Campo
            label="Beta (por kg)"
            value={config.costoFormula.beta}
            onChange={(v) => actualizar({ costoFormula: { ...config.costoFormula, beta: v } })}
            step={0.001}
            suffix="USD/kg"
          />
          <Campo
            label="Gamma (por km)"
            value={config.costoFormula.gamma}
            onChange={(v) => actualizar({ costoFormula: { ...config.costoFormula, gamma: v } })}
            step={0.01}
            suffix="USD/km"
          />
        </div>
        <Campo
          label="Peso del criterio 'kg' al prorratear costo entre PDV de una misma ruta"
          value={config.pesoAsignacionPct}
          onChange={(v) => actualizar({ pesoAsignacionPct: Math.min(1, Math.max(0, v)) })}
          step={0.05}
          suffix="0 = solo distancia marginal, 1 = solo peso"
        />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-bogati-brown/10 p-5 space-y-4">
        <h2 className="font-semibold text-bogati-brown">Cantidad mínima para el pago mínimo</h2>
        <p className="text-xs text-bogati-brown/50">
          Tomado de la tabla de costos logísticos de aperturas del transportista. Un viaje que no llega a estas
          cantidades por producto se marca con una alerta, y si su ruta no tiene precio pactado, se cobra el flete
          referencial de aperturas en vez de la fórmula lineal de respaldo.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Campo
            label="Helado — tachos mínimos"
            value={config.minimosCarga.heladoTachos}
            onChange={(v) => actualizar({ minimosCarga: { ...config.minimosCarga, heladoTachos: v } })}
            step={1}
            suffix="tachos"
          />
          <Campo
            label="Helado — litros por tacho"
            value={config.minimosCarga.litrosPorTachoHelado}
            onChange={(v) => actualizar({ minimosCarga: { ...config.minimosCarga, litrosPorTachoHelado: v } })}
            step={1}
            suffix="L/tacho"
          />
          <Campo
            label="Queso — unidades mínimas"
            value={config.minimosCarga.quesoUnidades}
            onChange={(v) => actualizar({ minimosCarga: { ...config.minimosCarga, quesoUnidades: v } })}
            step={1}
            suffix="unidades"
          />
          <Campo
            label="Queso — kg por unidad"
            value={config.minimosCarga.kgPorUnidadQueso}
            onChange={(v) => actualizar({ minimosCarga: { ...config.minimosCarga, kgPorUnidadQueso: v } })}
            step={0.1}
            suffix="kg/unidad"
          />
          <Campo
            label="Crema de leche mínima"
            value={config.minimosCarga.cremaLitros}
            onChange={(v) => actualizar({ minimosCarga: { ...config.minimosCarga, cremaLitros: v } })}
            step={1}
            suffix="litros"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-bogati-brown/10 p-5 space-y-4">
        <h2 className="font-semibold text-bogati-brown">Depósito / planta de despacho</h2>
        <p className="text-xs text-bogati-brown/50">
          Parque Industrial de Ambato (vía a Quito), de donde salen todos los camiones. Ajusta si cambia la
          ubicación real de despacho.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Campo
            label="Latitud"
            value={config.depot.lat}
            onChange={(v) => actualizar({ depot: { ...config.depot, lat: v } })}
            step={0.0001}
          />
          <Campo
            label="Longitud"
            value={config.depot.lon}
            onChange={(v) => actualizar({ depot: { ...config.depot, lon: v } })}
            step={0.0001}
          />
        </div>
      </div>

      <button
        onClick={resetear}
        className="text-sm text-bogati-brown/60 underline hover:text-bogati-brown"
      >
        Restaurar valores por defecto
      </button>
    </div>
  );
}
