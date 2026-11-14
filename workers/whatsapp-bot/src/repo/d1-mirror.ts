/**
 * Espejo D1 de las escrituras del bot (migración Supabase → D1, modo dual).
 * Envuelve los repos SQL: después de cada escritura relee de Supabase las filas
 * tocadas y las copia a D1 con la capa de datos de la app (lista blanca,
 * parametrizado, actor de sistema). Solo con DATA_BACKEND = "dual" | "d1" y el
 * binding D1 (el binding `DB` del bot es Hyperdrive). Un fallo de D1 se registra
 * sin datos y no cambia la respuesta del bot: Supabase sigue siendo la fuente de verdad.
 */
import { mirrorRows } from "../../../../src/lib/data/mirror.ts";
import type { SqlDatabase } from "../../../../src/lib/data/sql.ts";
import type { BotRepo, InboundRepo } from "./types.ts";

export interface BotMirrorEnv {
  DATA_BACKEND?: string;
  D1?: SqlDatabase;
}

type Row = Record<string, unknown>;

/** Lectura de filas en Supabase por clave (inyectable para tests). */
export interface MirrorReader {
  conversationsById(ids: string[]): Promise<Row[]>;
  /** Todas las conversaciones que comparten los últimos 10 dígitos con esta (pausa fail-closed). */
  conversationsSharingTail(conversationId: string): Promise<Row[]>;
  messagesByWamid(wamid: string): Promise<Row[]>;
  clientsByPhoneTail(phone: string): Promise<Row[]>;
}

const SYSTEM = { kind: "system", reason: "whatsapp-bot" } as const;

export function botMirrorEnabled(env: BotMirrorEnv): env is BotMirrorEnv & { D1: SqlDatabase } {
  const mode = env.DATA_BACKEND?.trim().toLowerCase();
  return (mode === "dual" || mode === "d1") && Boolean(env.D1);
}

function errorCode(err: unknown): string {
  if (!(err instanceof Error)) return "unknown";
  return /\b(UNIQUE|CHECK|FOREIGN KEY|NOT NULL|D1_[A-Z_]+)\b/.exec(err.message)?.[1] ?? err.name;
}

function copier(db: SqlDatabase) {
  return async (op: string, table: string, read: () => Promise<Row[]>): Promise<void> => {
    try {
      await mirrorRows(db, SYSTEM, table, await read());
    } catch (err) {
      console.warn("[d1-mirror]", JSON.stringify({ kind: "mirror_error", op: `whatsapp-bot:${op}`, error: errorCode(err) }));
    }
  };
}

export function mirrorInboundRepo(repo: InboundRepo, env: BotMirrorEnv, read: MirrorReader): InboundRepo {
  if (!botMirrorEnabled(env)) return repo;
  const copy = copier(env.D1);
  return {
    ...repo,
    async upsertConversation(phone, name) {
      const conv = await repo.upsertConversation(phone, name);
      await copy("upsertConversation", "wa_conversations", () => read.conversationsById([conv.id]));
      return conv;
    },
    async ensureConversation(phone) {
      const conv = await repo.ensureConversation(phone);
      await copy("ensureConversation", "wa_conversations", () => read.conversationsById([conv.id]));
      return conv;
    },
    async pauseBot(conversationId, until) {
      const n = await repo.pauseBot(conversationId, until);
      await copy("pauseBot", "wa_conversations", () => read.conversationsSharingTail(conversationId));
      return n;
    },
    async saveInbound(conversationId, message) {
      const saved = await repo.saveInbound(conversationId, message);
      if (saved) await copy("saveInbound", "wa_messages", () => read.messagesByWamid(message.wamid));
      return saved;
    },
    async saveEcho(conversationId, message) {
      const saved = await repo.saveEcho(conversationId, message);
      if (saved) await copy("saveEcho", "wa_messages", () => read.messagesByWamid(message.wamid));
      return saved;
    },
    async updateStatus(wamid, status) {
      await repo.updateStatus(wamid, status);
      await copy("updateStatus", "wa_messages", () => read.messagesByWamid(wamid));
    },
  };
}

export function mirrorBotRepo(repo: BotRepo, env: BotMirrorEnv, read: MirrorReader): BotRepo {
  if (!botMirrorEnabled(env)) return repo;
  const copy = copier(env.D1);
  return {
    ...repo,
    async setTakeover(conversationId) {
      await repo.setTakeover(conversationId);
      await copy("setTakeover", "wa_conversations", () => read.conversationsById([conversationId]));
    },
    async setMarketingOptIn(phone, optIn) {
      const n = await repo.setMarketingOptIn(phone, optIn);
      if (n > 0) await copy("setMarketingOptIn", "clients", () => read.clientsByPhoneTail(phone));
      return n;
    },
    async saveOutbound(conversationId, wamid, body) {
      await repo.saveOutbound(conversationId, wamid, body);
      await copy("saveOutbound", "wa_messages", () => read.messagesByWamid(wamid));
    },
    async saveTranscript(wamid, text) {
      await repo.saveTranscript(wamid, text);
      await copy("saveTranscript", "wa_messages", () => read.messagesByWamid(wamid));
    },
  };
}
