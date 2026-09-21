import { Categoria } from "./types";

export interface ProductoConversion {
  producto: string; // texto tal como aparece en el pedido, normalizado (mayúsculas, sin tildes extra)
  categoria: Categoria;
  kgPorUnidad: number; // kg equivalentes por 1 unidad de "unidad"
  unidad: "LT" | "KG" | "UNID";
}

// Densidades/pesos por defecto cuando un producto nuevo no está todavía en la tabla editable
// (data/productos-conversion.json). Se calibran con los productos reales observados en el
// histórico de pedidos (Bogati) y son ajustables desde /config sin tocar código.
export const DEFAULT_DENSITY_KG_POR_LITRO: Record<Categoria, number> = {
  HELADO: 0.6, // helado envasado: 0.55-0.65 kg/L según sabor/aireado
  QUESO: 1.0,
  CREMA: 1.03, // crema de leche pasteurizada, densidad cercana a la del agua/leche
};

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
}

/** Intenta extraer un peso en kg desde el nombre del producto, ej. "...De 700 Gr X Unid" -> 0.7 */
function extraerPesoDesdeNombre(producto: string): number | null {
  const texto = normalizar(producto);
  const kgMatch = texto.match(/(\d+(?:[.,]\d+)?)\s*KG/);
  if (kgMatch) return parseFloat(kgMatch[1].replace(",", "."));
  const grMatch = texto.match(/(\d+(?:[.,]\d+)?)\s*GR/);
  if (grMatch) return parseFloat(grMatch[1].replace(",", ".")) / 1000;
  const ltMatch = texto.match(/(\d+(?:[.,]\d+)?)\s*(LT|LITRO)/);
  if (ltMatch) return null; // se resuelve por densidad, no por peso directo
  return null;
}

export function resolverPesoKg(
  producto: string,
  unidad: string,
  cantidad: number,
  categoria: Categoria,
  tabla: ProductoConversion[]
): { pesoKg: number; fuente: "tabla" | "nombre_producto" | "densidad_default" } {
  const key = normalizar(producto);
  const enTabla = tabla.find((p) => normalizar(p.producto) === key);
  if (enTabla) {
    return { pesoKg: cantidad * enTabla.kgPorUnidad, fuente: "tabla" };
  }

  const u = unidad.trim().toUpperCase();

  if (u === "KG") {
    return { pesoKg: cantidad, fuente: "densidad_default" };
  }

  if (u === "UNID") {
    const pesoUnitario = extraerPesoDesdeNombre(producto);
    if (pesoUnitario) {
      return { pesoKg: cantidad * pesoUnitario, fuente: "nombre_producto" };
    }
    return { pesoKg: cantidad * 1.0, fuente: "densidad_default" }; // 1kg/unidad por defecto, revisar en /config
  }

  // LT u otras unidades de volumen: usar densidad por categoría
  const densidad = DEFAULT_DENSITY_KG_POR_LITRO[categoria] ?? 1.0;
  return { pesoKg: cantidad * densidad, fuente: "densidad_default" };
}
