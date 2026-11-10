import type { createAdminClient } from "@/utils/supabase/admin";
import { isDemoMode } from "@/lib/demo/mode";
import { shiftDay, type ShiftStatus } from "@/lib/courier-shift-day";

type Db = ReturnType<typeof createAdminClient>;

/** Habilitación diaria de repartidores (migración 029). En modo demo todos quedan habilitados. */

export interface CourierShift {
  id: string;
  userId: string;
  courierName: string;
  day: string;
  status: ShiftStatus;
  requestedAt: string;
  decidedAt: string | null;
}

interface ShiftRow {
  id: string;
  user_id: string;
  courier_name: string;
  shift_day: string;
  status: string;
  requested_at: string;
  decided_at: string | null;
}

const COLUMNS = "id, user_id, courier_name, shift_day, status, requested_at, decided_at";

function toShift(row: ShiftRow): CourierShift {
  return {
    id: row.id,
    userId: row.user_id,
    courierName: row.courier_name,
    day: row.shift_day,
    status: row.status as ShiftStatus,
    requestedAt: row.requested_at,
    decidedAt: row.decided_at,
  };
}

/**
 * Pide la habilitación del día al abrir la sesión. Si ya existe (aceptada, pendiente o rechazada), la deja
 * como está: el repartidor no puede volver a pedirla después de un rechazo recargando la página.
 */
export async function requestShift(db: Db, userId: string, courierName: string, now = new Date()): Promise<ShiftStatus> {
  if (isDemoMode()) return "approved";
  const day = shiftDay(now);
  const { error } = await db
    .from("courier_shifts")
    .upsert({ user_id: userId, courier_name: courierName, shift_day: day }, { onConflict: "user_id,shift_day", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  const { data, error: readError } = await db
    .from("courier_shifts")
    .select("status")
    .eq("user_id", userId)
    .eq("shift_day", day)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  return (data?.status as ShiftStatus | undefined) ?? "pending";
}

/** Solicitudes y habilitaciones del día de trabajo actual, las pendientes primero. */
export async function listShifts(db: Db, now = new Date()): Promise<CourierShift[]> {
  if (isDemoMode()) return [];
  const { data, error } = await db
    .from("courier_shifts")
    .select(COLUMNS)
    .eq("shift_day", shiftDay(now))
    .order("requested_at", { ascending: true });
  if (error) throw new Error(error.message);
  const order: Record<ShiftStatus, number> = { pending: 0, approved: 1, rejected: 2 };
  return (data as ShiftRow[]).map(toShift).sort((a, b) => order[a.status] - order[b.status]);
}

/** Nombres de los repartidores habilitados hoy. `null` en modo demo: ahí no se filtra. */
export async function approvedCourierNames(db: Db, now = new Date()): Promise<string[] | null> {
  if (isDemoMode()) return null;
  const { data, error } = await db
    .from("courier_shifts")
    .select("courier_name")
    .eq("shift_day", shiftDay(now))
    .eq("status", "approved");
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((r) => r.courier_name))];
}

/** Si un repartidor puede tomar o recibir pedidos hoy. */
export async function isCourierApproved(db: Db, courierName: string, now = new Date()): Promise<boolean> {
  const names = await approvedCourierNames(db, now);
  return names === null || names.includes(courierName);
}

/** Acepta o rechaza una solicitud del día actual. También sirve para deshabilitar a alguien ya aceptado. */
export async function decideShift(
  db: Db,
  id: string,
  status: Exclude<ShiftStatus, "pending">,
  now = new Date(),
): Promise<CourierShift | null> {
  const { data, error } = await db
    .from("courier_shifts")
    .update({ status, decided_at: now.toISOString() })
    .eq("id", id)
    .eq("shift_day", shiftDay(now))
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toShift(data as ShiftRow) : null;
}
