import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { guardAdmin } from "@/lib/auth/adminGuard";
import { TEST_PHONE } from "@/lib/agent/settings";
import { nombreSeguro, recortarTexto, type DerivacionAviso } from "@/lib/conversaciones/aviso-derivacion";

const LIMIT = 20;

/**
 * Conversaciones que el bot pasó a una persona (human_takeover activo), para el aviso del panel.
 * Liviano: sin teléfono completo y con el último mensaje recortado.
 */
export async function GET(req: NextRequest) {
  const denied = await guardAdmin(req, 120);
  if (denied) return denied;

  const db = createAdminClient();
  const { data: conversations } = await db
    .from("wa_conversations")
    .select("id, client_phone, client_id, contact_name, last_inbound_at, updated_at, created_at")
    .eq("human_takeover", true)
    .neq("client_phone", TEST_PHONE)
    .order("updated_at", { ascending: false })
    .limit(LIMIT);
  const list = conversations ?? [];
  if (list.length === 0) return NextResponse.json([]);

  const clientIds = [...new Set(list.map((c) => c.client_id).filter((id): id is string => Boolean(id)))];
  const [{ data: clients }, { data: messages }] = await Promise.all([
    clientIds.length > 0 ? db.from("clients").select("id, name").in("id", clientIds) : Promise.resolve({ data: [] }),
    db
      .from("wa_messages")
      .select("conversation_id, type, body, created_at")
      .in("conversation_id", list.map((c) => c.id))
      .order("created_at", { ascending: false })
      .limit(LIMIT * 5),
  ]);

  const names = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const lastBy = new Map<string, string>();
  for (const m of messages ?? []) {
    if (!lastBy.has(m.conversation_id)) lastBy.set(m.conversation_id, m.body ?? (m.type === "audio" ? "Audio" : "Mensaje"));
  }

  const out: DerivacionAviso[] = list.map((c) => ({
    id: c.id,
    nombre: nombreSeguro((c.client_id && names.get(c.client_id)) || c.contact_name, c.client_phone),
    desde: c.updated_at ?? c.last_inbound_at ?? c.created_at,
    ultimoMensaje: recortarTexto(lastBy.get(c.id)),
  }));
  return NextResponse.json(out);
}
