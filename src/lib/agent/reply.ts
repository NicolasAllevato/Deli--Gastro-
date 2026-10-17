import { createAdminClient } from "@/utils/supabase/admin";
import type { Database } from "@/types/database";
import { isDemoMode } from "@/lib/demo/mode";
import { createDemoLlm } from "./demoLlm.ts";
import { isOpenNow } from "./hours.ts";
import { runAgent } from "./loop.ts";
import { createOpenAI } from "./openai.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { loadAgentSettings, loadOpenAIKey, type AgentSettings } from "./settings.ts";
import { buildTools } from "./tools.ts";
import type { ChatMessage, LLM } from "./types.ts";

type Db = ReturnType<typeof createAdminClient>;
type Conversation = Database["public"]["Tables"]["wa_conversations"]["Row"];

export type AgentLlm = LLM & { transcribe?: (audio: ArrayBuffer, mimeType: string) => Promise<string> };

const HISTORY_MESSAGES = 20;
const FALLBACK_REPLY = "Perdón, tuve un problema para responderte. Si querés, escribime de nuevo o te paso con una persona del local.";

/** OpenAI si hay clave; en el demo, el modelo de juguete; sin ninguno, null. */
export async function resolveLlm(db: Db, settings: AgentSettings): Promise<AgentLlm | null> {
  const apiKey = await loadOpenAIKey(db);
  if (apiKey) return createOpenAI({ apiKey, model: settings.model });
  return isDemoMode() ? createDemoLlm() : null;
}

/** Últimos mensajes de la conversación en formato de chat (los del cliente van como `user`). */
export async function loadHistory(db: Db, conversationId: string): Promise<ChatMessage[]> {
  const { data } = await db
    .from("wa_messages")
    .select("direction, body, type, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_MESSAGES);

  return [...(data ?? [])]
    .reverse()
    .filter((m) => m.body)
    .map((m): ChatMessage => ({
      role: m.direction === "in" ? "user" : "assistant",
      content: m.type === "audio" && m.direction === "in" ? `[audio] ${m.body}` : (m.body ?? ""),
    }));
}

export interface ReplyParams {
  db: Db;
  llm: LLM;
  settings: AgentSettings;
  conversation: Conversation;
  messageId: string;
  history: readonly ChatMessage[];
  dryRun: boolean;
}

export interface Reply {
  text: string;
  tokens: number;
}

/** Arma el prompt con los datos del negocio y corre el agente hasta tener una respuesta. */
export async function generateReply(params: ReplyParams): Promise<Reply> {
  const { db, settings, conversation } = params;

  let customerName = conversation.contact_name;
  if (conversation.client_id) {
    const { data } = await db.from("clients").select("name").eq("id", conversation.client_id).maybeSingle();
    customerName = data?.name ?? customerName;
  }

  const system = buildSystemPrompt({
    businessName: settings.businessName,
    agentName: settings.name,
    tone: settings.tone,
    instructions: settings.instructions,
    isOpen: isOpenNow(settings.hours.open, settings.hours.close),
    hours: settings.hours,
    paused: settings.paused,
    estimatedMinutes: settings.estimatedMinutes,
    customerName,
  });

  const result = await runAgent({
    llm: params.llm,
    system,
    history: params.history,
    tools: buildTools({ db, conversation, messageId: params.messageId, dryRun: params.dryRun }),
    fallbackReply: FALLBACK_REPLY,
  });
  return { text: result.reply, tokens: result.tokens };
}

export { loadAgentSettings };
