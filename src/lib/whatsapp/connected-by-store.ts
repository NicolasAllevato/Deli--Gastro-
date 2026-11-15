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
import { readStoredSecrets, writeStoredSecrets } from "./config.ts";
import type { IntegrationSettingsDb as SqlDatabase } from "@/lib/data";

type Db = ReturnType<typeof createAdminClient>;

/**
 * Guarda quién cerró el alta en UNA sola fila (upsert atómico: reemplaza por completo lo anterior, así no
 * quedan restos de otra persona). Se llama DESPUÉS de que la conexión salió bien; lanza si la base falla.
 */
export async function saveConnectedBy(
  db: Db,
  input: { admin: ConnectedByAdmin; facebook?: FacebookProfile; now?: Date },
  d1?: SqlDatabase,
): Promise<void> {
  const value = serializeConnectedBy(
    buildConnectedBy({ admin: input.admin, facebook: input.facebook, now: input.now ?? new Date() }),
  );
  try {
    await writeStoredSecrets(db, [{ key: CONNECTED_BY_KEY, value }], d1);
  } catch (error: unknown) {
    throw new Error(`No se pudo guardar quién conectó el número: ${error instanceof Error ? error.message : "error desconocido"}`);
  }
}

/** Quién cerró la última conexión. Si la base falla se registra el motivo (sin datos personales) y se muestra «sin registro». */
export async function loadConnectedBy(db: Db, d1?: SqlDatabase): Promise<ConnectedBySummary | null> {
  try {
    return summarizeConnectedBy((await readStoredSecrets(db, [CONNECTED_BY_KEY], d1)).get(CONNECTED_BY_KEY));
  } catch (error: unknown) {
    console.error("[whatsapp.connected-by] no se pudo leer:", error instanceof Error ? error.message : "error desconocido");
    return null;
  }
}
