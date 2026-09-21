import * as XLSX from "xlsx";
import { Categoria, PedidoItem } from "./types";
import { buscarPdv } from "./pdvData";
import { resolverPesoKg } from "./productWeights";
import { PRODUCTOS_CONVERSION } from "./pdvData";

export interface FilaError {
  fila: number;
  motivo: string;
  datos: Record<string, any>;
}

export interface ResultadoParseo {
  items: PedidoItem[];
  errores: FilaError[];
  pdvNoEncontrados: string[];
  formatoDetectado: "ancho" | "largo" | "desconocido";
}

const CATEGORIAS_VALIDAS: Categoria[] = ["HELADO", "QUESO", "CREMA"];

function normalizarCategoria(raw: string): Categoria | null {
  const c = raw.trim().toUpperCase();
  if (c.startsWith("HELAD")) return "HELADO";
  if (c.startsWith("QUES")) return "QUESO";
  if (c.startsWith("CREM")) return "CREMA";
  return CATEGORIAS_VALIDAS.includes(c as Categoria) ? (c as Categoria) : null;
}

function normalizarHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
}

// Columnas que aparecen en el reporte semanal real de Bogati (formato "ancho": una fila
// por PDV, una columna por producto) que NO son productos y deben ignorarse.
const COLUMNAS_NO_PRODUCTO = new Set([
  "PUNTO DE VENTA",
  "# DE ORDEN",
  "PROVINCIA",
  "FECHA DE PEDIDO",
  "NOMBRE Y APELLIDO DEL ADMINISTRADOR",
  "CEDULA DEL ADMINISTRADOR",
  "CONTACTO DEL ADMINISTRADOR",
  "DIRECCION",
  "TOTAL DE LITROS",
  "TOTAL DE TACHOS",
  "PRECIO",
  "TRANSPORTE",
  "TOTAL",
  "RUTA",
  "OBSERVACIONES",
]);

function categoriaDesdeHeader(header: string): Categoria | null {
  const h = normalizarHeader(header);
  if (h.includes("HELAD")) return "HELADO";
  if (h.includes("QUES")) return "QUESO";
  if (h.includes("CREM")) return "CREMA";
  return null;
}

/**
 * A partir del texto del encabezado de columna, decide en qué unidad viene la cantidad.
 * Importante: "X UNID" tiene prioridad aunque el nombre del producto mencione un peso
 * (ej. "QUESO FRESCO DELI DE 650 GR X UNID") — ahí la cantidad son UNIDADES compradas, no
 * gramos; el peso de 650gr por unidad se extrae aparte del nombre del producto en
 * resolverPesoKg. Si se tratara "GR" como la unidad de la columna se dividiría la cantidad
 * de unidades por 1000 por error.
 */
function unidadDesdeHeader(header: string, categoria: Categoria): "LT" | "KG" | "UNID" {
  const h = normalizarHeader(header);
  if (/\bX\s*UNID\b|\bUNID(AD)?ES?\b/.test(h)) return "UNID";
  if (/\bLITRO\b|\bX\s*LT\b|\bLT\b/.test(h)) return "LT";
  if (/\bX\s*KG\b|\bKILO/.test(h)) return "KG";
  return categoria === "QUESO" ? "KG" : "LT"; // valor por defecto según el catálogo real de Bogati
}

function esFormatoAncho(headers: string[]): boolean {
  const norm = headers.map(normalizarHeader);
  return norm.includes("PUNTO DE VENTA");
}

function esFormatoLargo(headers: string[]): boolean {
  const norm = headers.map(normalizarHeader);
  return norm.includes("PDV") && norm.includes("CATEGORIA") && norm.includes("PRODUCTO");
}

/**
 * Parsea el reporte semanal REAL de Bogati: una fila por PDV, una columna por producto
 * (ej. "HELADO VAINILLA X LITRO (CANT MIN 12LT)"), más columnas de totales/ruta que se
 * ignoran. Es el formato que ya usan hoy para armar el pedido (Reporte de "# de orden").
 */
function parseFormatoAncho(rows: Record<string, any>[], headers: string[]): ResultadoParseo {
  const items: PedidoItem[] = [];
  const errores: FilaError[] = [];
  const pdvNoEncontrados = new Set<string>();

  const columnasPdv = headers.find((h) => normalizarHeader(h) === "PUNTO DE VENTA")!;
  const columnasProducto = headers.filter((h) => {
    const norm = normalizarHeader(h);
    return !COLUMNAS_NO_PRODUCTO.has(norm) && norm !== normalizarHeader(columnasPdv);
  });

  rows.forEach((row, idx) => {
    const filaNum = idx + 2;
    const pdvNombre = String(row[columnasPdv] ?? "").trim();
    if (!pdvNombre) return; // fila vacía, se ignora sin marcar error
    if (/^(TOTAL|NOTA)/.test(normalizarHeader(pdvNombre))) return; // fila de totales/notas al pie del reporte

    const pdv = buscarPdv(pdvNombre);
    if (!pdv) {
      pdvNoEncontrados.add(pdvNombre);
      errores.push({ fila: filaNum, motivo: `PDV "${pdvNombre}" no existe en el maestro`, datos: { [columnasPdv]: pdvNombre } });
      return;
    }

    let algunaCantidad = false;
    for (const header of columnasProducto) {
      const categoria = categoriaDesdeHeader(header);
      if (!categoria) continue; // columna que no reconocemos como categoría de producto

      const raw = row[header];
      const cantidad = typeof raw === "number" ? raw : parseFloat(String(raw ?? "0").replace(",", "."));
      if (!cantidad || cantidad <= 0 || isNaN(cantidad)) continue;
      algunaCantidad = true;

      const unidad = unidadDesdeHeader(header, categoria);
      const { pesoKg } = resolverPesoKg(header, unidad, cantidad, categoria, PRODUCTOS_CONVERSION);

      items.push({
        pdvId: pdv.id,
        categoria,
        producto: header,
        cantidad,
        unidad,
        pesoKg: Math.round(pesoKg * 100) / 100,
      });
    }

    if (!algunaCantidad) {
      errores.push({ fila: filaNum, motivo: `"${pdvNombre}" no tiene cantidades mayores a 0 en ninguna columna de producto`, datos: {} });
    }
  });

  return { items, errores, pdvNoEncontrados: [...pdvNoEncontrados], formatoDetectado: "ancho" };
}

/** Parsea el formato "largo" propio de la plantilla descargable (PDV, CATEGORIA, PRODUCTO, CANTIDAD, UNIDAD). */
function parseFormatoLargo(rows: Record<string, any>[]): ResultadoParseo {
  const items: PedidoItem[] = [];
  const errores: FilaError[] = [];
  const pdvNoEncontrados = new Set<string>();

  rows.forEach((row, idx) => {
    const filaNum = idx + 2;
    const pdvNombre = String(row["PDV"] ?? "").trim();
    const categoriaRaw = String(row["CATEGORIA"] ?? "").trim();
    const producto = String(row["PRODUCTO"] ?? "").trim();
    const cantidad = parseFloat(String(row["CANTIDAD"] ?? "").replace(",", "."));
    const unidad = String(row["UNIDAD"] ?? "").trim();

    if (!pdvNombre || !producto || isNaN(cantidad) || cantidad <= 0) {
      errores.push({ fila: filaNum, motivo: "Faltan datos obligatorios o cantidad inválida", datos: row });
      return;
    }

    const pdv = buscarPdv(pdvNombre);
    if (!pdv) {
      pdvNoEncontrados.add(pdvNombre);
      errores.push({ fila: filaNum, motivo: `PDV "${pdvNombre}" no existe en el maestro`, datos: row });
      return;
    }

    const categoria = normalizarCategoria(categoriaRaw);
    if (!categoria) {
      errores.push({ fila: filaNum, motivo: `Categoría "${categoriaRaw}" inválida (usar HELADO, QUESO o CREMA)`, datos: row });
      return;
    }

    const { pesoKg } = resolverPesoKg(producto, unidad || "KG", cantidad, categoria, PRODUCTOS_CONVERSION);

    items.push({
      pdvId: pdv.id,
      categoria,
      producto,
      cantidad,
      unidad: unidad || "KG",
      pesoKg: Math.round(pesoKg * 100) / 100,
    });
  });

  return { items, errores, pdvNoEncontrados: [...pdvNoEncontrados], formatoDetectado: "largo" };
}

const MAX_FILAS_BUSQUEDA_ENCABEZADO = 10;

/**
 * Algunos reportes de proveedores traen 2-3 filas de título/membrete antes de la fila real
 * de encabezados (ej. "REQUISICIÓN DE COMPRA DE MATERIA PRIMA..."). Se busca entre las
 * primeras filas cuál contiene "PUNTO DE VENTA" o el trío "PDV"+"CATEGORIA"+"PRODUCTO", y
 * esa se usa como encabezado real, descartando lo anterior.
 */
function encontrarFilaEncabezado(filas: any[][]): number {
  const limite = Math.min(filas.length, MAX_FILAS_BUSQUEDA_ENCABEZADO);
  for (let i = 0; i < limite; i++) {
    const celdas = filas[i].map((c) => normalizarHeader(String(c ?? "")));
    if (celdas.includes("PUNTO DE VENTA")) return i;
    if (celdas.includes("PDV") && celdas.includes("CATEGORIA") && celdas.includes("PRODUCTO")) return i;
  }
  return 0; // no se encontró un patrón conocido: se asume la primera fila (comportamiento anterior)
}

function filasABjetos(filas: any[][], headerIdx: number): { rows: Record<string, any>[]; headers: string[] } {
  const headerRow = filas[headerIdx].map((c) => String(c ?? "").trim());
  const rows = filas.slice(headerIdx + 1).map((fila) => {
    const obj: Record<string, any> = {};
    headerRow.forEach((h, i) => {
      if (h) obj[h] = fila[i] ?? "";
    });
    return obj;
  });
  return { rows, headers: headerRow.filter((h) => h) };
}

/**
 * Parsea el archivo semanal de pedidos. Reconoce automáticamente dos formatos:
 *  - "ancho": el reporte real que ya genera Bogati (una fila por PDV, una columna por
 *    producto — ej. "Pedidos de la semana del 7 de septiembre.xlsx", o los reportes por
 *    proveedor con membrete de "Requisición de compra" antes del encabezado).
 *  - "largo": la plantilla simple de esta plataforma (PDV, CATEGORIA, PRODUCTO,
 *    CANTIDAD, UNIDAD), útil para cargar pedidos armados a mano.
 */
export function parsePedidosSemanales(fileBuffer: ArrayBuffer): ResultadoParseo {
  const wb = XLSX.read(fileBuffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const filasCrudas: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false });

  if (filasCrudas.length === 0) {
    return {
      items: [],
      errores: [{ fila: 1, motivo: "El archivo está vacío.", datos: {} }],
      pdvNoEncontrados: [],
      formatoDetectado: "desconocido",
    };
  }

  const headerIdx = encontrarFilaEncabezado(filasCrudas);
  const { rows, headers } = filasABjetos(filasCrudas, headerIdx);

  if (esFormatoAncho(headers)) return parseFormatoAncho(rows, headers);
  if (esFormatoLargo(headers)) return parseFormatoLargo(rows);

  return {
    items: [],
    errores: [
      {
        fila: 1,
        motivo:
          'No se reconoce el formato del archivo. Debe tener una columna "Punto de venta" (reporte semanal de Bogati) o las columnas PDV, CATEGORIA, PRODUCTO, CANTIDAD, UNIDAD (plantilla de esta plataforma).',
        datos: { columnas: headers },
      },
    ],
    pdvNoEncontrados: [],
    formatoDetectado: "desconocido",
  };
}

/** Genera un archivo .xlsx de plantilla descargable para que el usuario cargue el pedido semanal. */
export function generarPlantillaXlsx(): ArrayBuffer {
  const ejemplo = [
    { PDV: "TUNG AMBATO CENTRO", CATEGORIA: "QUESO", PRODUCTO: "Queso Fresco Bogati De 1 Kg X Unid", CANTIDAD: 48, UNIDAD: "KG" },
    { PDV: "TUNG AMBATO CENTRO", CATEGORIA: "CREMA", PRODUCTO: "Crema De Leche Past. X Litro", CANTIDAD: 10, UNIDAD: "LT" },
    { PDV: "GUAY GYE URDESA", CATEGORIA: "HELADO", PRODUCTO: "Helado Vainilla X Litro", CANTIDAD: 24, UNIDAD: "LT" },
  ];
  const ws = XLSX.utils.json_to_sheet(ejemplo);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Pedido");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}
