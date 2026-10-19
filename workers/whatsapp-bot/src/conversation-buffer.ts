import { DurableObject } from "cloudflare:workers";
import { addMessage, combineBatch, emptyBatch, flushAt, isFull, type Batch, type BufferedMessage } from "./batching.ts";

/** Turno listo para el clasificador: un mensaje combinado por conversación. */
export interface InboundTurn {
  phone: string;
  text: string;
  wamids: string[];
  receivedAt: number;
}

export interface BufferEnv {
  INBOUND: Queue<InboundTurn>;
}

const BATCH_KEY = "batch";
const PHONE_KEY = "phone";

/**
 * Un Durable Object por teléfono (`idFromName(phone)`): Cloudflare garantiza una sola instancia por
 * conversación, así que los mensajes de una ráfaga se apilan sin carreras aunque lleguen en paralelo.
 * Cuando vence el silencio (alarma) o se llena el lote, encola UN turno en `wa-inbound`.
 */
export class ConversationBuffer extends DurableObject<BufferEnv> {
  async add(phone: string, message: BufferedMessage): Promise<void> {
    const batch = addMessage((await this.ctx.storage.get<Batch>(BATCH_KEY)) ?? emptyBatch(), message);
    await this.ctx.storage.put({ [BATCH_KEY]: batch, [PHONE_KEY]: phone });
    const at = isFull(batch) ? Date.now() : flushAt(batch);
    if (at !== null) await this.ctx.storage.setAlarm(at);
  }

  async alarm(): Promise<void> {
    const batch = (await this.ctx.storage.get<Batch>(BATCH_KEY)) ?? emptyBatch();
    const phone = await this.ctx.storage.get<string>(PHONE_KEY);
    const due = flushAt(batch);
    if (due === null || !phone) return;
    // Llegó otro mensaje después de programar la alarma: esperar al nuevo silencio.
    if (!isFull(batch) && Date.now() < due) {
      await this.ctx.storage.setAlarm(due);
      return;
    }
    const turn = combineBatch(batch);
    // Se encola antes de borrar: si falla, la alarma reintenta y el lote no se pierde.
    if (turn.text.length > 0) {
      await this.env.INBOUND.send({ phone, text: turn.text, wamids: turn.wamids, receivedAt: batch.firstAt ?? Date.now() });
    }
    await this.ctx.storage.delete(BATCH_KEY);
  }
}
