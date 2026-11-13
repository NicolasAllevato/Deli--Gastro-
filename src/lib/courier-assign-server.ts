import type { createAdminClient } from "@/utils/supabase/admin";
import { shiftDay } from "@/lib/courier-shift-day";
import { COURIER_ASSIGN_MODE_KEY, buildCandidates, parseAssignMode, pickCourier, type CourierAssignMode } from "@/lib/courier-assign";

type Db = ReturnType<typeof createAdminClient>;

/** Modo guardado en `global_config`; si falta o no se puede leer, "libre" (el comportamiento de siempre). */
export async function getAssignMode(db: Db): Promise<CourierAssignMode> {
  const { data, error } = await db.from("global_config").select("value").eq("key", COURIER_ASSIGN_MODE_KEY).maybeSingle();
  if (error) {
    console.error("[courier-assign] leyendo el modo", error.message);
    return parseAssignMode(null);
  }
  return parseAssignMode(data?.value);
}

/** Repartidor habilitado hoy con menos pedidos en curso (empate: el que hace más que no recibe uno). */
export async function autoPickCourier(db: Db, now = new Date()): Promise<string | null> {
  const { data: shifts, error } = await db
    .from("courier_shifts")
    .select("courier_name")
    .eq("shift_day", shiftDay(now))
    .eq("status", "approved");
  if (error) throw new Error(error.message);
  const names = [...new Set((shifts ?? []).map((s) => s.courier_name))];
  if (names.length === 0) return null;

  const [{ data: active, error: activeError }, { data: events, error: eventsError }] = await Promise.all([
    db.from("orders").select("courier_name").in("status", ["En Preparación", "En Camino"]).in("courier_name", names),
    db.from("order_events").select("detail, created_at").eq("event", "assigned").in("detail", names).order("created_at", { ascending: false }).limit(500),
  ]);
  if (activeError) throw new Error(activeError.message);
  if (eventsError) throw new Error(eventsError.message);

  const lastAssigned = new Map<string, string>();
  for (const e of events ?? []) {
    if (e.detail && !lastAssigned.has(e.detail)) lastAssigned.set(e.detail, e.created_at);
  }
  return pickCourier(buildCandidates(names, (active ?? []).map((o) => o.courier_name), lastAssigned));
}
