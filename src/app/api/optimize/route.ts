import { NextRequest, NextResponse } from "next/server";
import { optimizarSemana } from "@/lib/optimizer";
import { CONFIG_DEFAULT } from "@/lib/pdvData";
import { PedidoItem, ConfigOptimizacion } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const items: PedidoItem[] = body.items;
    const semana: string = body.semana ?? new Date().toISOString().slice(0, 10);
    const configOverrides: Partial<ConfigOptimizacion & { depot: { lat: number; lon: number } }> =
      body.config ?? {};

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "No se recibieron items de pedido." }, { status: 400 });
    }

    const config = { ...CONFIG_DEFAULT, ...configOverrides };
    const resultado = await optimizarSemana(items, config, semana);

    return NextResponse.json(resultado);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err?.message ?? "Error al optimizar" }, { status: 500 });
  }
}
