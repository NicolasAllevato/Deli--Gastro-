import { createAdminClient } from "@/utils/supabase/admin";
import type { Database } from "@/types/database";
import { samePhone } from "./phone.ts";

type Db = ReturnType<typeof createAdminClient>;
type Conversation = Database["public"]["Tables"]["wa_conversations"]["Row"];

/**
 * El cliente de una conversación; si todavía no existe, se registra con el teléfono y el
 * nombre del perfil de WhatsApp. Los clientes de WhatsApp no tienen cuenta web (`user_id` null).
 */
export async function ensureClientForConversation(db: Db, conversation: Conversation): Promise<string> {
  if (conversation.client_id) return conversation.client_id;

  const { data, error } = await db
    .from("clients")
    .insert({ name: conversation.contact_name ?? "Cliente WhatsApp", phone: `+${conversation.client_phone}` })
    .select("id")
    .single();
  if (error) throw new Error("No se pudo registrar al cliente.");

  await db.from("wa_conversations").update({ client_id: data.id }).eq("id", conversation.id);
  return data.id;
}

const MAX_CLIENTS_SCANNED = 2000;

/** Todos los clientes cargados con ese teléfono (web y WhatsApp pueden haber creado filas distintas). */
export async function clientIdsWithPhone(db: Db, phone: string): Promise<string[]> {
  const { data } = await db.from("clients").select("id, phone").not("phone", "is", null).limit(MAX_CLIENTS_SCANNED);
  return (data ?? []).filter((c) => c.phone && samePhone(c.phone, phone)).map((c) => c.id);
}
