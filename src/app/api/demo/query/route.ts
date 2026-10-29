import { NextResponse } from "next/server";
import { rejectCrossOrigin } from "@/lib/auth/requireRole";
import { cookies } from "next/headers";
import { z } from "zod";
import { DEMO_COOKIE, isDemoMode } from "@/lib/demo/mode";
import { accountByRole } from "@/lib/demo/users";
import { executePlan, type QueryPlan } from "@/lib/demo/query";
import { getStore } from "@/lib/demo/store";

// Las tablas de WhatsApp (credenciales, conversaciones, campañas) NO se exponen acá: ningún código del
// navegador las consulta y, en el demo, cualquier sesión podría leer lo que el admin cargó.
const planSchema = z.object({
  table: z.enum(["clients", "orders", "points_ledger", "global_config", "categories", "products", "reviews", "order_events", "delivery_zones"]),
  action: z.enum(["select", "insert", "update", "upsert", "delete"]),
  columns: z.string(),
  filters: z.array(
    z.object({
      op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "is", "ilike", "like", "not"]),
      column: z.string(),
      value: z.unknown(),
    }),
  ),
  order: z.array(z.object({ column: z.string(), ascending: z.boolean() })),
  limit: z.number().int().nonnegative().nullable(),
  payload: z.unknown(),
  onConflict: z.string(),
  returning: z.boolean(),
  count: z.boolean(),
  head: z.boolean(),
  single: z.enum(["none", "single", "maybe"]),
});

/** Ejecuta un plan de consulta del cliente falso del navegador (solo modo demo). */
export async function POST(req: Request) {
  const crossOrigin = rejectCrossOrigin(req);
  if (crossOrigin) return crossOrigin;

  if (!isDemoMode()) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const cookieStore = await cookies();
  if (!accountByRole(cookieStore.get(DEMO_COOKIE)?.value)) {
    return NextResponse.json({ data: null, error: { message: "No autorizado", code: "401" }, count: null });
  }

  const parsed = planSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Plan inválido." }, { status: 400 });

  return NextResponse.json(executePlan(parsed.data as QueryPlan, getStore()));
}
