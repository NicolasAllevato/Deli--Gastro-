/**
 * Apilador de mensajes por conversación (lógica pura, sin Cloudflare).
 * La gente escribe en ráfagas («hola» / «quiero 2 muzza» / «a Belgrano 123»): el bot espera un silencio corto,
 * junta hasta `maxMessages` mensajes y responde UNA vez al conjunto.
 * Responde cuando pasa lo primero de: silencio de `quietMs`, `maxWaitMs` desde el primer mensaje, o lote lleno.
 */

export const BATCH_POLICY = {
  /** Silencio después del último mensaje antes de responder. */
  quietMs: 4_000,
  /** Espera máxima desde el primer mensaje del lote (aunque siga escribiendo). */
  maxWaitMs: 12_000,
  /** Con este número de mensajes responde sin esperar más. */
  maxMessages: 5,
} as const;

export type MessageKind = "text" | "audio" | "location" | "image" | "other";

export interface BufferedMessage {
  wamid: string;
  /** Texto ya listo para el clasificador (audios transcriptos, ubicación como coordenadas). */
  text: string;
  /** Hora de llegada en ms. */
  at: number;
  kind: MessageKind;
  /** Audio todavía sin transcribir (el consumidor lo transcribe y reemplaza `[audio:<wamid>]`) o foto a guardar. */
  mediaId?: string;
}

export interface Batch {
  messages: readonly BufferedMessage[];
  firstAt: number | null;
  lastAt: number | null;
}

export interface CombinedTurn {
  text: string;
  wamids: string[];
  /** Audios pendientes de transcribir, en el orden en que aparecen en `text`. */
  audios: { wamid: string; mediaId: string }[];
  /** Fotos del lote (se guardan en el reclamo abierto). En `text` aparecen como `[foto]` + su epígrafe. */
  images: { wamid: string; mediaId: string }[];
}

/** Marca que deja un audio sin transcribir dentro del texto combinado. */
export const audioPlaceholder = (wamid: string): string => `[audio:${wamid}]`;

export function emptyBatch(): Batch {
  return { messages: [], firstAt: null, lastAt: null };
}

/** Devuelve un lote nuevo con el mensaje agregado; un wamid repetido no cambia nada. */
export function addMessage(batch: Batch, message: BufferedMessage): Batch {
  if (batch.messages.some((m) => m.wamid === message.wamid)) return batch;
  const messages = [...batch.messages, message].sort((a, b) => a.at - b.at);
  return {
    messages,
    firstAt: batch.firstAt === null ? message.at : Math.min(batch.firstAt, message.at),
    lastAt: batch.lastAt === null ? message.at : Math.max(batch.lastAt, message.at),
  };
}

/**
 * Lo que queda del lote después de encolar `sent`: los mensajes que llegaron mientras se encolaba
 * (el Durable Object atiende otros pedidos durante la espera de la cola) no se pueden borrar sin responder.
 */
export function withoutSent(batch: Batch, sent: readonly string[]): Batch {
  const done = new Set(sent);
  return batch.messages.filter((m) => !done.has(m.wamid)).reduce(addMessage, emptyBatch());
}

export function isFull(batch: Batch): boolean {
  return batch.messages.length >= BATCH_POLICY.maxMessages;
}

/** Momento (ms) en que hay que responder el lote, o null si está vacío. */
export function flushAt(batch: Batch): number | null {
  if (batch.firstAt === null || batch.lastAt === null) return null;
  return Math.min(batch.lastAt + BATCH_POLICY.quietMs, batch.firstAt + BATCH_POLICY.maxWaitMs);
}

const KIND_LABEL: Record<MessageKind, string> = { text: "", audio: "[audio] ", location: "[ubicación] ", image: "[foto] ", other: "[adjunto] " };

/** Une el lote en un solo turno para el clasificador y el respondedor. */
export function combineBatch(batch: Batch): CombinedTurn {
  const isImage = (m: BufferedMessage) => m.kind === "image" && m.mediaId !== undefined;
  const pending = (m: BufferedMessage) => !isImage(m) && m.mediaId !== undefined && m.text.trim().length === 0;
  const useful = batch.messages.filter((m) => isImage(m) || pending(m) || m.text.trim().length > 0);
  return {
    images: useful.filter(isImage).map((m) => ({ wamid: m.wamid, mediaId: m.mediaId as string })),
    text: useful
      .map((m) => (pending(m) ? audioPlaceholder(m.wamid) : `${KIND_LABEL[m.kind]}${m.text.trim()}`.trim()))
      .join("\n"),
    wamids: batch.messages.map((m) => m.wamid),
    audios: useful.filter(pending).map((m) => ({ wamid: m.wamid, mediaId: m.mediaId as string })),
  };
}
