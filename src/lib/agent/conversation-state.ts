import type { createAdminClient } from "@/utils/supabase/admin";
import type { Json } from "@/types/database";

type Db = ReturnType<typeof createAdminClient>;

/**
 * Cambia `wa_conversations.state` sin pisar escrituras ajenas: lee, aplica `mutate` sobre el estado
 * leído y actualiza solo si `updated_at` sigue igual. Si otro proceso escribió en el medio, reintenta
 * una vez sobre el estado nuevo. Devuelve `false` (sin lanzar) si no pudo.
 */
export async function updateConversationState(
  db: Db,
  conversationId: string,
  mutate: (state: unknown) => Record<string, unknown>,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await db.from("wa_conversations").select("state, updated_at").eq("id", conversationId).maybeSingle();
    if (error || !data) return false;
    const { data: written, error: writeError } = await db
      .from("wa_conversations")
      .update({ state: mutate(data.state) as unknown as Json })
      .eq("id", conversationId)
      .eq("updated_at", data.updated_at)
      .select("id")
      .maybeSingle();
    if (!writeError && written) return true;
  }
  return false;
}
