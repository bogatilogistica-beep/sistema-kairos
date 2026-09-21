"use client";

import { useEffect, useState } from "react";
import { CONFIG_DEFAULT } from "./pdvData";
import { ConfigOptimizacion } from "./types";

export type ConfigCompleta = ConfigOptimizacion & { depot: { lat: number; lon: number } };

const STORAGE_KEY = "bogati-rutas-config";

export function leerConfigGuardada(): ConfigCompleta {
  if (typeof window === "undefined") return CONFIG_DEFAULT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return CONFIG_DEFAULT;
    return { ...CONFIG_DEFAULT, ...JSON.parse(raw) };
  } catch {
    return CONFIG_DEFAULT;
  }
}

export function guardarConfig(config: ConfigCompleta) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function restaurarConfigPorDefecto() {
  window.localStorage.removeItem(STORAGE_KEY);
}

export function useConfig() {
  const [config, setConfig] = useState<ConfigCompleta>(CONFIG_DEFAULT);
  const [cargado, setCargado] = useState(false);

  useEffect(() => {
    setConfig(leerConfigGuardada());
    setCargado(true);
  }, []);

  const actualizar = (parcial: Partial<ConfigCompleta>) => {
    const nuevo = { ...config, ...parcial };
    setConfig(nuevo);
    guardarConfig(nuevo);
  };

  const resetear = () => {
    restaurarConfigPorDefecto();
    setConfig(CONFIG_DEFAULT);
  };

  return { config, actualizar, resetear, cargado };
}
