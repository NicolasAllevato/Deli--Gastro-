import { agentHandler } from "@/lib/agent/handler";
import { clientFor, loadWhatsAppSettings } from "./config.ts";
import { clientIdsWithPhone, ensureClientForConversation } from "./clients.ts";
import type { InboundContext, InboundHandler } from "./inbound.ts";
import { detectKeyword, type Keyword } from "./keywords.ts";

const REPLIES: Record<Keyword, string> = {
  opt_in: "¡Listo! Te anotamos para recibir promociones. Cuando quieras dejar de recibirlas, respondé BAJA.",
  opt_out: "Listo, no vas a recibir más promociones. Si cambiás de idea, escribí ALTA. Seguimos acá para tus pedidos.",
};

/** Alta o baja de promociones por palabra clave. Devuelve true si el mensaje era una (y ya se atendió). */
async function handleKeyword(ctx: InboundContext): Promise<boolean> {
  const { content } = ctx.message;
  const keyword = content.type === "text" ? detectKeyword(content.text) : null;
  if (!keyword) return false;

  const { db, conversation } = ctx;
  const clientId = await ensureClientForConversation(db, conversation);
  // La baja vale para todas las filas con ese teléfono: si no, una fila duplicada seguiría recibiendo promos.
  const ids = keyword === "opt_out"
    ? [...new Set([clientId, ...(await clientIdsWithPhone(db, conversation.client_phone))])]
    : [clientId];
  await db.from("clients").update({ wa_marketing_opt_in: keyword === "opt_in" }).in("id", ids);

  const wa = clientFor(await loadWhatsAppSettings(db));
  if (wa) {
    const wamid = await wa.sendText(conversation.client_phone, REPLIES[keyword]);
    await db.from("wa_messages").insert({
      conversation_id: conversation.id, wamid, direction: "out", type: "text", body: REPLIES[keyword],
    });
  }
  return true;
}

/** Orden de atención de cada mensaje entrante: primero las palabras clave, después el agente. */
export const inboundHandler: InboundHandler = async (ctx) => {
  if (await handleKeyword(ctx)) return;
  await agentHandler(ctx);
};
