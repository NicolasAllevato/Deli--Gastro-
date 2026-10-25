import { createHmac, randomInt } from "node:crypto";
import { z } from "zod";
import type { createAdminClient } from "@/utils/supabase/admin";

type Db = ReturnType<typeof createAdminClient>;

/**
 * Repartidores con ingreso por PIN de 4 dígitos (migración 020).
 * El PIN identifica al repartidor, así que es único. Se guarda solo su HMAC con una clave del
 * servidor: sin la clave, la tabla no alcanza para probar los 10.000 PIN posibles.
 */

export const PIN_LENGTH = 4;
export const pinSchema = z.string().regex(/^\d{4}$/, "El PIN tiene que tener 4 números.");
export const courierNameSchema = z.string().trim().min(2, "Poné el nombre del repartidor.").max(60);

export interface Courier {
  userId: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Lo que hace falta de Supabase Auth: se inyecta para poder probarlo sin la nube. */
export interface CourierAuth {
  /** Crea el usuario de Auth con rol repartidor; devuelve su id. */
  createUser(name: string): Promise<{ id: string } | { error: string }>;
  /** Bloquea o habilita el usuario (al desactivar, se cortan también las sesiones abiertas). */
  setBlocked(userId: string, blocked: boolean): Promise<string | null>;
}

export type CourierResult = { ok: true; courier: Courier; pin: string } | { ok: false; status: number; error: string };

/** Clave fija del modo demo (sin service role). El repartidor de ejemplo entra con DEMO_COURIER_PIN. */
export const DEMO_PIN_SECRET = "demo-courier-pin";
export const DEMO_COURIER_PIN = "1234";

const PIN_TAKEN = "Ese PIN ya lo usa otro repartidor. Elegí otro o generá uno.";

/** Clave del HMAC. Sin COURIER_PIN_SECRET usa la service role (solo existe en el servidor). */
export function pinSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.COURIER_PIN_SECRET || env.SUPABASE_SERVICE_ROLE_KEY;
  if (secret) return secret;
  if (env.NEXT_PUBLIC_DEMO_MODE === "true") return DEMO_PIN_SECRET;
  throw new Error("Falta COURIER_PIN_SECRET o SUPABASE_SERVICE_ROLE_KEY para los PIN de repartidores.");
}

export function hashPin(pin: string, secret: string = pinSecret()): string {
  return createHmac("sha256", secret).update(`courier-pin:${pin}`).digest("hex");
}

export function generatePin(): string {
  return String(randomInt(0, 10 ** PIN_LENGTH)).padStart(PIN_LENGTH, "0");
}

type CourierRow = { user_id: string; name: string; active: boolean; created_at: string; updated_at: string };

const toCourier = (r: CourierRow): Courier => ({
  userId: r.user_id,
  name: r.name,
  active: r.active,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const COLUMNS = "user_id, name, active, created_at, updated_at";

export async function listCouriers(db: Db): Promise<Courier[]> {
  const { data, error } = await db.from("couriers").select(COLUMNS).order("name", { ascending: true });
  if (error) throw new Error(`No se pudieron leer los repartidores: ${error.message}`);
  return ((data ?? []) as CourierRow[]).map(toCourier);
}

async function pinTaken(db: Db, pinHash: string, exceptUserId?: string): Promise<boolean> {
  const { data, error } = await db.from("couriers").select("user_id").eq("pin_hash", pinHash);
  if (error) throw new Error(`No se pudo verificar el PIN: ${error.message}`);
  return ((data ?? []) as { user_id: string }[]).some((r) => r.user_id !== exceptUserId);
}

/** PIN pedido por el admin, o uno al azar que no esté en uso. */
async function choosePin(db: Db, requested: string | undefined, exceptUserId?: string): Promise<string | null> {
  if (requested) return (await pinTaken(db, hashPin(requested), exceptUserId)) ? null : requested;
  for (let i = 0; i < 50; i++) {
    const pin = generatePin();
    if (!(await pinTaken(db, hashPin(pin), exceptUserId))) return pin;
  }
  return null;
}

const isUniqueViolation = (error: { code?: string } | null): boolean => error?.code === "23505";

export async function createCourier(
  db: Db,
  auth: CourierAuth,
  input: { name: string; pin?: string },
): Promise<CourierResult> {
  const pin = await choosePin(db, input.pin);
  if (!pin) return { ok: false, status: 409, error: PIN_TAKEN };

  const created = await auth.createUser(input.name);
  if ("error" in created) return { ok: false, status: 502, error: created.error };

  const { data, error } = await db
    .from("couriers")
    .insert({ user_id: created.id, name: input.name, pin_hash: hashPin(pin) })
    .select(COLUMNS)
    .single();
  if (error || !data) {
    return isUniqueViolation(error)
      ? { ok: false, status: 409, error: PIN_TAKEN }
      : { ok: false, status: 500, error: "No se pudo guardar el repartidor." };
  }
  return { ok: true, courier: toCourier(data as CourierRow), pin };
}

export async function changeCourierPin(db: Db, userId: string, requested?: string): Promise<CourierResult> {
  const pin = await choosePin(db, requested, userId);
  if (!pin) return { ok: false, status: 409, error: PIN_TAKEN };

  const { data, error } = await db
    .from("couriers")
    .update({ pin_hash: hashPin(pin), updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .select(COLUMNS)
    .maybeSingle();
  if (isUniqueViolation(error)) return { ok: false, status: 409, error: PIN_TAKEN };
  if (error) return { ok: false, status: 500, error: "No se pudo cambiar el PIN." };
  if (!data) return { ok: false, status: 404, error: "Repartidor no encontrado." };
  return { ok: true, courier: toCourier(data as CourierRow), pin };
}

export async function setCourierActive(
  db: Db,
  auth: CourierAuth,
  userId: string,
  active: boolean,
): Promise<{ ok: true; courier: Courier } | { ok: false; status: number; error: string }> {
  const { data, error } = await db
    .from("couriers")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .select(COLUMNS)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: "No se pudo actualizar el repartidor." };
  if (!data) return { ok: false, status: 404, error: "Repartidor no encontrado." };

  const blockError = await auth.setBlocked(userId, !active);
  if (blockError) return { ok: false, status: 502, error: blockError };
  return { ok: true, courier: toCourier(data as CourierRow) };
}

/** Repartidor activo con ese PIN, o null. */
export async function findCourierByPin(db: Db, pin: string): Promise<Courier | null> {
  const { data, error } = await db
    .from("couriers")
    .select(COLUMNS)
    .eq("pin_hash", hashPin(pin))
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(`No se pudo verificar el PIN: ${error.message}`);
  return data ? toCourier(data as CourierRow) : null;
}
