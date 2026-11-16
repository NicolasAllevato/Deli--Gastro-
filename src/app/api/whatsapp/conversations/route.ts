import { safeError } from "@/lib/whatsapp/privacy";
import { NextRequest, NextResponse, after } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { guardAdmin } from "@/lib/auth/adminGuard";
import { TEST_PHONE } from "@/lib/agent/settings";
import { createOpenWAClient, isOpenWAProvider, openwaConfigFromEnv } from "@/lib/whatsapp/openwa";

const LIST_LIMIT = 50;
/** La vista refresca la lista seguido: la sesión de OpenWA se revisa como mucho una vez por minuto. */
const SESSION_CHECK_MS = 60_000;
let lastSessionCheck = 0;

/**
 * Con la vista abierta, una sesión de OpenWA que quedó desconectada (redeploy de EasyPanel) se
 * vuelve a arrancar sola; si no, los mensajes de los clientes no llegan y no se guardan.
 */
function keepOpenWASessionAlive() {
  const cfg = isOpenWAProvider() ? openwaConfigFromEnv() : null;
  if (!cfg || Date.now() - lastSessionCheck < SESSION_CHECK_MS) return;
  lastSessionCheck = Date.now();
  after(async () => {
    try {
      if (!(await createOpenWAClient(cfg).ensureActive())) {
        console.error("[openwa] la sesión no está lista: necesita QR, tiene una falla o la frenaron a mano");
      }
    } catch (error: unknown) {
      console.error("[openwa] no se pudo revisar la sesión", safeError(error));
    }
  });
}

/** Conversaciones recientes con el último mensaje y el nombre del cliente. */
export async function GET(req: NextRequest) {
  const denied = await guardAdmin(req, 120);
  if (denied) return denied;
  keepOpenWASessionAlive();

  const db = createAdminClient();
  const { data: conversations } = await db
    .from("wa_conversations")
    .select("*")
    .neq("client_phone", TEST_PHONE)
    // Un chat que inició el local (todavía sin mensajes del cliente) va al final, no arriba de todo.
    .order("last_inbound_at", { ascending: false, nullsFirst: false })
    .limit(LIST_LIMIT);
  const list = conversations ?? [];
  if (list.length === 0) return NextResponse.json([]);

  const clientIds = [...new Set(list.map((c) => c.client_id).filter((id): id is string => Boolean(id)))];
  const [{ data: clients }, { data: messages }] = await Promise.all([
    clientIds.length > 0 ? db.from("clients").select("id, name").in("id", clientIds) : Promise.resolve({ data: [] }),
    db
      .from("wa_messages")
      .select("conversation_id, direction, type, body, created_at")
      .in("conversation_id", list.map((c) => c.id))
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT * 5),
  ]);

  const names = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const lastByConversation = new Map<string, { direction: string; text: string; at: string }>();
  for (const m of messages ?? []) {
    if (!lastByConversation.has(m.conversation_id)) {
      lastByConversation.set(m.conversation_id, {
        direction: m.direction,
        text: m.body ?? (m.type === "audio" ? "🎤 Audio" : "Mensaje"),
        at: m.created_at,
      });
    }
  }

  return NextResponse.json(
    list.map((c) => ({
      id: c.id,
      phone: c.client_phone,
      name: (c.client_id && names.get(c.client_id)) || c.contact_name || c.client_phone,
      humanTakeover: c.human_takeover,
      botPausedUntil: c.bot_paused_until ?? null,
      lastInboundAt: c.last_inbound_at,
      last: lastByConversation.get(c.id) ?? null,
    })),
  );
}
