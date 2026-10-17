import { z } from "zod";

/** Segmentos de campaña aceptados por la API (misma forma que `Segment`). */
export const segmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("inactive"), days: z.number().int().min(1).max(365) }),
  z.object({ kind: z.literal("frequent"), minOrders: z.number().int().min(1).max(50) }),
  z.object({ kind: z.literal("tier"), tier: z.enum(["Bronce", "Plata", "Oro", "Platino"]) }),
]);
