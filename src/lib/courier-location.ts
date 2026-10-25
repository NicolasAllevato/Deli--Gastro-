import { z } from "zod";
import type { createAdminClient } from "@/utils/supabase/admin";

type Db = ReturnType<typeof createAdminClient>;

/** Cada cuánto manda su posición el teléfono del repartidor. */
export const LOCATION_SEND_MS = 15_000;
/** Una posición más vieja que esto no se muestra: el repartidor cerró la app o perdió señal hace rato. */
export const LOCATION_STALE_MS = 10 * 60_000;

export const locationSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().nonnegative().max(100_000).nullish(),
  heading: z.number().finite().min(0).max(360).nullish(),
  speed: z.number().finite().nonnegative().max(100).nullish(),
});
export type LocationInput = z.infer<typeof locationSchema>;

export interface CourierLocation {
  courierName: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  updatedAt: string;
}

export async function saveCourierLocation(db: Db, userId: string, courierName: string, input: LocationInput): Promise<string | null> {
  const { error } = await db.from("courier_locations").upsert(
    {
      user_id: userId,
      courier_name: courierName,
      lat: input.lat,
      lng: input.lng,
      accuracy_m: input.accuracy ?? null,
      heading: input.heading ?? null,
      speed_mps: input.speed ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  return error?.message ?? null;
}

/** Sin entregas en curso no hay por qué seguir guardando dónde está la persona. */
export async function clearCourierLocation(db: Db, userId: string): Promise<void> {
  await db.from("courier_locations").delete().eq("user_id", userId);
}

export async function listCourierLocations(db: Db, now: Date = new Date()): Promise<CourierLocation[]> {
  const since = new Date(now.getTime() - LOCATION_STALE_MS).toISOString();
  const { data } = await db
    .from("courier_locations")
    .select("courier_name, lat, lng, accuracy_m, heading, updated_at")
    .gte("updated_at", since)
    .order("updated_at", { ascending: false });
  return (data ?? []).map((r) => ({
    courierName: r.courier_name,
    lat: Number(r.lat),
    lng: Number(r.lng),
    accuracy: r.accuracy_m === null ? null : Number(r.accuracy_m),
    heading: r.heading === null ? null : Number(r.heading),
    updatedAt: r.updated_at,
  }));
}
