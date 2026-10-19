/**
 * Fase 4: un turno agrupado por el apilador → una sola respuesta.
 * Orden: humano a cargo → límites → audios → ALTA/BAJA → guardrail de entrada → clasificador →
 * respondedor con herramientas de su intención → guardrail de salida → envío y registro.
 */
import { classify, MIN_CONFIDENCE, type Intent } from "../ai/classifier.ts";
import { respond } from "../ai/responder.ts";
import type { ChatMessage, RunModel } from "../ai/models.ts";
import { audioPlaceholder } from "../batching.ts";
import type { InboundTurn } from "../turn-types.ts";
import { inspectInbound, inspectOutbound, wrapUntrusted } from "../guardrails.ts";
import type { BotConversation, BotRepo } from "../repo/bot.ts";
import { detectKeyword } from "../../../../src/lib/whatsapp/keywords.ts";
import { decideInboundLimit } from "../../../../src/lib/agent/limits.ts";
import { buildResponderPrompt, orderReply, REPLIES } from "./prompts.ts";
import { settingsFromConfig, type BotSettings } from "./settings.ts";
import { toolsFor } from "./tools.ts";

export interface TurnDeps {
  repo: BotRepo;
  run: RunModel;
  /** Descarga y transcribe un audio de WhatsApp; null si no se pudo. */
  transcribe: (mediaId: string) => Promise<string | null>;
  /** Envía un texto por la Cloud API y devuelve el wamid. */
  send: (phone: string, text: string) => Promise<string>;
  /** URL pública de la app (links permitidos en las respuestas). */
  appUrl: string;
  log: (message: string, detail?: unknown) => void;
}

export type TurnOutcome =
  | "takeover" | "inactive" | "rate_silent" | "rate_notify" | "keyword"
  | "blocked" | "unclear" | "order_redirect" | "answered" | "output_blocked" | "no_conversation" | "empty";

const HISTORY_TURNS = 8;
const ORDER_INTENTS: readonly Intent[] = ["pedido_nuevo", "pedido_datos", "pedido_confirmar", "pedido_cancelar"];
const ALLOWED_HOSTS = ["mpago.la", "mercadopago.com.ar", "google.com", "maps.google.com"];

async function reply(deps: TurnDeps, conversation: BotConversation, text: string): Promise<void> {
  const wamid = await deps.send(conversation.phone, text);
  // Se guarda en wa_messages: el panel muestra lo que respondió el bot (coexistencia).
  await deps.repo.saveOutbound(conversation.id, wamid, text);
}

/** Reemplaza cada `[audio:<wamid>]` por su transcripción (y la guarda para el panel). */
async function resolveAudios(turn: InboundTurn, deps: TurnDeps, settings: BotSettings): Promise<string | null> {
  let text = turn.text;
  for (const audio of turn.audios) {
    const heard = settings.transcribeAudio ? await deps.transcribe(audio.mediaId).catch(() => null) : null;
    if (!heard) return null;
    await deps.repo.saveTranscript(audio.wamid, heard);
    text = text.replace(audioPlaceholder(audio.wamid), `[audio] ${heard}`);
  }
  return text;
}

function historyMessages(items: { direction: "in" | "out"; body: string }[]): ChatMessage[] {
  return items.map((m) => (m.direction === "in" ? { role: "user", content: wrapUntrusted(m.body) } : { role: "assistant", content: m.body }));
}

async function answer(turnText: string, intent: Intent, suspicious: boolean, conversation: BotConversation, settings: BotSettings, deps: TurnDeps): Promise<TurnOutcome> {
  // Los entrantes del final son este mismo turno (ya guardados por la entrada): van como userText, no como historial.
  const history = await deps.repo.history(conversation.id, HISTORY_TURNS + 5);
  while (history.at(-1)?.direction === "in") history.pop();
  const draft = await respond(deps.run, {
    system: buildResponderPrompt(settings, intent, conversation.displayName, suspicious),
    history: historyMessages(history),
    userText: wrapUntrusted(turnText),
    tools: suspicious ? [] : toolsFor(intent, deps.repo, conversation, settings),
  });

  const appHost = new URL(deps.appUrl).host;
  const check = inspectOutbound(draft, { customerPhone: conversation.phone, allowedHosts: [appHost, ...ALLOWED_HOSTS] });
  if (!draft || check.verdict === "block") {
    deps.log("[whatsapp-bot] respuesta bloqueada", { conversation: conversation.id, reasons: check.reasons, empty: !draft });
    await reply(deps, conversation, REPLIES.failure);
    await deps.repo.setTakeover(conversation.id);
    return "output_blocked";
  }
  await reply(deps, conversation, draft);
  return "answered";
}

export async function processTurn(turn: InboundTurn, deps: TurnDeps): Promise<TurnOutcome> {
  const conversation = await deps.repo.getConversation(turn.phone);
  if (!conversation) return "no_conversation";
  if (conversation.humanTakeover) return "takeover";

  const settings = settingsFromConfig(await deps.repo.config());
  if (!settings.active) return "inactive";

  const limit = decideInboundLimit(await deps.repo.inboundCounts(conversation.id));
  if (limit === "silent") return "rate_silent";
  if (limit === "notify") {
    await reply(deps, conversation, REPLIES.rateLimited);
    return "rate_notify";
  }

  const text = await resolveAudios(turn, deps, settings);
  if (text === null) {
    await reply(deps, conversation, REPLIES.audioFailed);
    return "empty";
  }
  if (!text.trim()) return "empty";

  // ALTA/BAJA: solo si el turno entero es la palabra clave (sin IA).
  const keyword = detectKeyword(text);
  if (keyword) {
    await deps.repo.setMarketingOptIn(conversation.phone, keyword === "opt_in");
    await reply(deps, conversation, keyword === "opt_in" ? REPLIES.optIn : REPLIES.optOut);
    return "keyword";
  }

  const inbound = inspectInbound(text);
  if (inbound.verdict === "block") {
    deps.log("[whatsapp-bot] mensaje bloqueado", { conversation: conversation.id, reasons: inbound.reasons });
    await reply(deps, conversation, REPLIES.blocked);
    return "blocked";
  }

  const lastBot = (await deps.repo.history(conversation.id, 4)).filter((m) => m.direction === "out").at(-1)?.body ?? null;
  const { intent, confidence } = await classify(deps.run, wrapUntrusted(text), lastBot);

  if (intent === "humano") {
    await deps.repo.setTakeover(conversation.id);
    await reply(deps, conversation, REPLIES.handoff);
    return "answered";
  }
  if (confidence < MIN_CONFIDENCE) {
    await reply(deps, conversation, REPLIES.unclear);
    return "unclear";
  }
  if (ORDER_INTENTS.includes(intent)) {
    await reply(deps, conversation, orderReply(deps.appUrl, settings));
    return "order_redirect";
  }
  return answer(text, intent, inbound.verdict === "suspicious", conversation, settings, deps);
}
