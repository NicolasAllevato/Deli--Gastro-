import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { numberConfig, readConfig } from "@/lib/orders-server";
import { RESTAURANT_LOCATION } from "@/lib/restaurant";
import type { DeliveryZone, GeoPoint } from "@/lib/zones";

type Db = ReturnType<typeof createAdminClient>;

const latSchema = z.number().min(-90).max(90);
const lngSchema = z.number().min(-180).max(180);

export const zoneShapeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("circle"),
    lat: latSchema,
    lng: lngSchema,
    radius_km: z.number().positive().max(100),
  }),
  z.object({
    type: z.literal("polygon"),
    points: z.array(z.tuple([latSchema, lngSchema])).min(3).max(100),
  }),
]);

export const zoneInputSchema = z.object({
  name: z.string().trim().min(1, "Poné un nombre a la zona").max(60),
  shape: zoneShapeSchema,
  fee: z.number().finite().nonnegative().max(1_000_000),
  min_order: z.number().finite().nonnegative().max(10_000_000),
  sort_order: z.number().int().min(0).max(1000).optional(),
  is_active: z.boolean().optional(),
});

export type ZoneInput = z.infer<typeof zoneInputSchema>;

interface ZoneRow {
  id: string;
  name: string;
  shape: unknown;
  fee: number | string;
  min_order: number | string;
  sort_order: number;
  is_active: boolean;
}

/** Zonas ordenadas por prioridad. Descarta filas con una forma inválida en vez de romper el checkout. */
export async function listZones(db: Db): Promise<DeliveryZone[]> {
  const { data } = await db.from("delivery_zones").select("*").order("sort_order", { ascending: true });
  const zones: DeliveryZone[] = [];
  for (const row of (data ?? []) as unknown as ZoneRow[]) {
    const shape = zoneShapeSchema.safeParse(row.shape);
    if (!shape.success) continue;
    zones.push({
      id: row.id,
      name: row.name,
      shape: shape.data,
      fee: Number(row.fee),
      min_order: Number(row.min_order),
      sort_order: row.sort_order,
      is_active: row.is_active,
    });
  }
  return zones;
}

/** Ubicación del local desde la configuración (con la fija como respaldo). */
export function localFromConfig(config: Record<string, unknown>): GeoPoint {
  return {
    lat: numberConfig(config, "local_lat", RESTAURANT_LOCATION.lat),
    lng: numberConfig(config, "local_lng", RESTAURANT_LOCATION.lng),
  };
}

/** Todo lo necesario para cotizar un envío, en una sola lectura. */
export async function loadDeliverySettings(db: Db) {
  const [config, zones] = await Promise.all([readConfig(db), listZones(db)]);
  return {
    config,
    zones,
    quoteOptions: {
      local: localFromConfig(config),
      radiusKm: numberConfig(config, "radio_delivery_km", 8),
      costPerKm: numberConfig(config, "costo_por_km", 150),
    },
  };
}
