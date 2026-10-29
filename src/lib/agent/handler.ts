import { isBotSilenced } from "@/lib/whatsapp/pause";
import { createAdminClient } from "@/utils/supabase/admin";
import type { InboundContext, InboundHandler } from "@/lib/whatsapp/inbound";
import { clientFor, loadWhatsAppSettings } from "@/lib/whatsapp/config";
import type { WhatsAppClient } from "@/lib/whatsapp/client";
import { generateReply, loadAgentSettings, loadHistory, resolveLlm, type AgentLlm } from "./reply.ts";
import { decideInboundLimit, LIMITS, type InboundDecision } from "./limits.ts";
import type { AgentSettings } from "./settings.ts";

type Db = ReturnType<typeof createAdminClient>;

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const MSG_AUDIO_FAILED = "No pude escuchar el audio. ¿Me lo escribís?";
const MSG_AUDIO_OFF = "Por ahora no escuchamos audios por este medio. ¿Me lo escribís, así te ayudo?";
const MSG_UNSUPPORTED = "Por ahora solo entiendo mensajes de texto y audios. ¿Me contás qué necesitás?";
const MSG_RATE_LIMIT = "Recibí muchos mensajes tuyos seguidos y tengo que frenar un rato. Si es urgente, llamanos y te atiende una persona.";
const MSG_ERROR = "Tuve un problema para responderte. Probá de nuevo en un momento o escribinos y te atiende una persona.";

async function inboundDecision(db: Db, conversationId: string): Promise<InboundDecision> {
  const now = Date.now();
  const { data, error } = await db
    .from("wa_messages")
    .select("created_at")
    .eq("conversation_id", conversationId)
    .eq("direction", "in")
    .gte("created_at", new Date(now - DAY_MS).toISOString())
    .limit(LIMITS.perDay + 5);
  // Sin poder contar no hay tope: se calla en vez de gastar IA sin límite.
  if (error) {
    console.error("[agente] no se pudo leer el tope de mensajes", error.message);
    return "silent";
  }
  const times = (data ?? []).map((m) => new Date(m.created_at).getTime());
  return decideInboundLimit({
    lastDay: times.length,
    lastMinute: times.filter((t) => t >= now - MINUTE_MS).length,
  });
}

async function reply(db: Db, wa: WhatsAppClient, ctx: InboundContext, text: string, tokens: number | null = null) {
  const wamid = await wa.sendText(ctx.conversation.client_phone, text);
  await db.from("wa_messages").insert({
    conversation_id: ctx.conversation.id,
    wamid,
    direction: "out",
    type: "text",
    body: text,
    tokens,
  });
}

/** Texto del mensaje: el propio, o la transcripción si es un audio. null = no se pudo entender. */
async function textOf(db: Db, wa: WhatsAppClient, llm: AgentLlm, ctx: InboundContext): Promise<string | null> {
  const { content } = ctx.message;
  if (content.type === "text") return content.text;
  if (content.type !== "audio" || !llm.transcribe) return null;

  const media = await wa.downloadMedia(content.mediaId, MAX_AUDIO_BYTES);
  const transcript = await llm.transcribe(media.data, media.mimeType);
  if (!transcript) return null;
  // La transcripción queda guardada: el historial y el panel muestran lo que se escuchó.
  await db.from("wa_messages").update({ body: transcript }).eq("id", ctx.messageId);
  return transcript;
}

async function respond(db: Db, wa: WhatsAppClient, llm: AgentLlm, settings: AgentSettings, ctx: InboundContext) {
  // Audios apagados desde el panel: no se descargan ni se transcriben (sin costo de IA).
  if (ctx.message.content.type === "audio" && !settings.transcribeAudio) return reply(db, wa, ctx, MSG_AUDIO_OFF);

  let text: string | null;
  try {
    text = await textOf(db, wa, llm, ctx);
  } catch (error: unknown) {
    console.error("[agente] no se pudo procesar el audio", error);
    return reply(db, wa, ctx, MSG_AUDIO_FAILED);
  }
  if (text === null) {
    return reply(db, wa, ctx, ctx.message.content.type === "audio" ? MSG_AUDIO_FAILED : MSG_UNSUPPORTED);
  }

  // El mensaje ya está guardado, así que el historial incluye lo último que dijo el cliente.
  const history = await loadHistory(db, ctx.conversation.id);
  const answer = await generateReply({
    db, llm, settings, conversation: ctx.conversation, messageId: ctx.messageId, history, dryRun: false,
  });
  await reply(db, wa, ctx, answer.text, answer.tokens);
}

/** Atiende cada mensaje entrante de WhatsApp con el agente de pedidos. */
export const agentHandler: InboundHandler = async (ctx) => {
  const { db, conversation } = ctx;
  if (isBotSilenced(conversation)) return;

  const settings = await loadAgentSettings(db);
  if (!settings.active) return;

  const wa = clientFor(await loadWhatsAppSettings(db));
  const llm = await resolveLlm(db, settings);
  if (!wa || !llm) {
    console.error("[agente] activo pero falta configurar WhatsApp o la clave de OpenAI");
    return;
  }

  const limit = await inboundDecision(db, conversation.id);
  if (limit === "silent") return;

  try {
    if (limit === "notify") return await reply(db, wa, ctx, MSG_RATE_LIMIT);
    await respond(db, wa, llm, settings, ctx);
  } catch (error: unknown) {
    console.error("[agente] falló la respuesta", error);
    await reply(db, wa, ctx, MSG_ERROR).catch((sendError: unknown) => {
      console.error("[agente] tampoco se pudo avisar el error", sendError);
    });
  }
};
