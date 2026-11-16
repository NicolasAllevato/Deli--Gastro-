/**
 * Respuestas por turno sin duplicados y aviso cuando un turno se agota en la cola.
 *
 * - `onceSend`: la n-ésima respuesta de un turno se manda una sola vez. Si la cola reintenta el turno
 *   (falló algo después de responder), lo ya enviado se saltea y se devuelve el wamid guardado.
 * - `handleDeadTurn`: un turno que agotó los reintentos (wa-inbound-dlq) recibe UNA vez el aviso de falla,
 *   la conversación pasa a una persona (takeover) y el mensaje queda en el panel.
 */
import type { SqlDatabase } from "../../../src/lib/data/sql.ts";
import type { BotRepo } from "./repo/types.ts";
import type { InboundTurn } from "./turn-types.ts";

export interface ReplyLedger {
  get(turnKey: string, seq: string): Promise<string | null>;
  put(turnKey: string, seq: string, wamid: string): Promise<void>;
}

const MAX_KEY = 500;

/** Clave estable del turno: los wamids que lo forman (iguales en cada reintento de la cola). */
export function turnKey(turn: Pick<InboundTurn, "wamids" | "phone" | "receivedAt">): string {
  const ids = [...turn.wamids].sort().join(",");
  return (ids || `${turn.phone}:${turn.receivedAt}`).slice(0, MAX_KEY);
}

type Send = (phone: string, text: string) => Promise<string>;

/** Envoltorio de `send` para un turno: cada respuesta (por orden) sale una sola vez. */
export function onceSend(send: Send, ledger: ReplyLedger, key: string): Send {
  let seq = 0;
  return async (phone, text) => {
    const slot = String(seq);
    seq += 1;
    const previous = await ledger.get(key, slot);
    if (previous) return previous;
    const wamid = await send(phone, text);
    await ledger.put(key, slot, wamid);
    return wamid;
  };
}

export function d1Ledger(db: SqlDatabase): ReplyLedger {
  return {
    async get(key, seq) {
      const row = await db.prepare("SELECT wamid FROM wa_turn_replies WHERE turn_key = ? AND seq = ?").bind(key, seq).first<{ wamid: string }>();
      return row?.wamid ?? null;
    },
    async put(key, seq, wamid) {
      await db.prepare("INSERT INTO wa_turn_replies (turn_key, seq, wamid) VALUES (?, ?, ?) ON CONFLICT (turn_key, seq) DO NOTHING").bind(key, seq, wamid).run();
    },
  };
}

export const DEAD_SEQ = "dlq";

export interface DeadTurnDeps {
  repo: Pick<BotRepo, "getConversation" | "saveOutbound" | "setTakeover">;
  ledger: ReplyLedger;
  send: Send;
  /** Mensaje fijo (REPLIES.failure). */
  failureText: string;
  log: (message: string, detail?: unknown) => void;
}

export type DeadOutcome = "notified" | "already_notified" | "no_conversation";

/** Turno agotado: avisa al cliente una sola vez y deja la conversación en manos del local. */
export async function handleDeadTurn(turn: InboundTurn, deps: DeadTurnDeps): Promise<DeadOutcome> {
  const conversation = await deps.repo.getConversation(turn.phone);
  if (!conversation) return "no_conversation";
  const key = turnKey(turn);
  // El takeover va primero: aunque el envío falle, el local ve la conversación pendiente en el panel.
  await deps.repo.setTakeover(conversation.id);
  if (await deps.ledger.get(key, DEAD_SEQ)) return "already_notified";
  const wamid = await deps.send(conversation.phone, deps.failureText);
  await deps.ledger.put(key, DEAD_SEQ, wamid);
  await deps.repo.saveOutbound(conversation.id, wamid, deps.failureText);
  deps.log("[whatsapp-bot] turno agotado: se avisó al cliente y pasó a una persona", { conversation: conversation.id });
  return "notified";
}
