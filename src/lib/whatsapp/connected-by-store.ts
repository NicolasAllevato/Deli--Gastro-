import { createAdminClient } from "@/utils/supabase/admin";
import {
  buildConnectedBy,
  CONNECTED_BY_KEY,
  serializeConnectedBy,
  summarizeConnectedBy,
  type ConnectedByAdmin,
  type ConnectedBySummary,
  type FacebookProfile,
} from "./connected-by.ts";

type Db = ReturnType<typeof createAdminClient>;

/**
 * Guarda quién cerró el alta en UNA sola fila (upsert atómico: reemplaza por completo lo anterior, así no
 * quedan restos de otra persona). Se llama DESPUÉS de que la conexión salió bien; lanza si la base falla.
 */
export async function saveConnectedBy(
  db: Db,
  input: { admin: ConnectedByAdmin; facebook?: FacebookProfile; now?: Date },
): Promise<void> {
  const value = serializeConnectedBy(
    buildConnectedBy({ admin: input.admin, facebook: input.facebook, now: input.now ?? new Date() }),
  );
  const { error } = await db.from("integration_secrets").upsert({ key: CONNECTED_BY_KEY, value }, { onConflict: "key" });
  if (error) throw new Error(`No se pudo guardar quién conectó el número: ${error.message}`);
}

/** Quién cerró la última conexión. Si la base falla se registra el motivo (sin datos personales) y se muestra «sin registro». */
export async function loadConnectedBy(db: Db): Promise<ConnectedBySummary | null> {
  const { data, error } = await db.from("integration_secrets").select("key, value").in("key", [CONNECTED_BY_KEY]);
  if (error) {
    console.error("[whatsapp.connected-by] no se pudo leer:", error.message);
    return null;
  }
  return summarizeConnectedBy(data?.[0]?.value);
}
