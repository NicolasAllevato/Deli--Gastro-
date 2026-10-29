import { z } from "zod";

/**
 * Coexistencia WhatsApp Business app + Cloud API: campos del webhook que `parseWebhook` no cubre.
 * Parseo defensivo: lo que no encaja con el esquema se descarta (el webhook responde 200 igual).
 */

/** Tipos de media que se guardan con su tipo real y una etiqueta (el cuerpo nunca queda vacío). */
export const MEDIA_LABELS = { image: "[imagen]", video: "[video]", document: "[documento]" } as const;
export type MediaType = keyof typeof MEDIA_LABELS;

export type EchoContent =
  | { type: "text"; text: string }
  | { type: "media"; mediaType: MediaType; label: string }
  /** `edit` y `revoke` modifican un mensaje anterior: no son un mensaje nuevo y no pausan al bot. */
  | { type: "ignored"; rawType: "edit" | "revoke" }
  | { type: "unsupported"; rawType: string };

/** Mensaje que la persona envió desde la app WhatsApp Business al cliente (`smb_message_echoes`). */
export interface SmbEchoEvent {
  kind: "smb_echo";
  wamid: string;
  /** Teléfono del cliente (destinatario), tal como lo manda Meta. */
  to: string;
  /** Segundos Unix; 0 si Meta no lo mandó o no se pudo leer (quien procesa usa la hora actual). */
  timestamp: number;
  phoneNumberId: string;
  content: EchoContent;
}

/** Lote de sincronización de historial (`history`): solo se informan conteos, nunca el contenido. */
export interface HistoryEvent {
  kind: "history";
  phoneNumberId: string;
  phase: number | null;
  chunk: number | null;
  threads: number;
  messages: number;
  /** Código de error si Meta informó que la sincronización no se hizo (2593109 = la persona la rechazó). */
  errorCode: number | null;
  rejected: boolean;
}

/** Código con el que Meta avisa que la persona rechazó compartir el historial. */
export const HISTORY_DECLINED_CODE = 2593109;

/** Lote de sincronización de contactos (`smb_app_state_sync`): solo conteos. */
export interface AppStateSyncEvent {
  kind: "app_state_sync";
  phoneNumberId: string;
  contacts: number;
}

/** Evento de cuenta (`account_update`): solo el nombre del evento, sin acciones. */
export interface AccountUpdateEvent {
  kind: "account_update";
  event: string;
}

export type CoexistenceEvent = SmbEchoEvent | HistoryEvent | AppStateSyncEvent | AccountUpdateEvent;

const metadata = z.object({ phone_number_id: z.string().min(1) });

const rawEcho = z.object({
  id: z.string().min(1),
  to: z.string().min(1),
  // Meta lo manda como texto; se acepta también número. Si no parsea se usa la hora actual (no se descarta el eco).
  timestamp: z.union([z.string(), z.number()]).optional(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
});

const echoValue = z.object({ metadata, message_echoes: z.array(z.unknown()).default([]) });

const historyValue = z.object({
  metadata,
  history: z
    .array(
      z.object({
        metadata: z.object({ phase: z.coerce.number().optional(), chunk_order: z.coerce.number().optional() }).optional(),
        threads: z.array(z.object({ messages: z.array(z.unknown()).default([]) })).default([]),
        errors: z.array(z.object({ code: z.coerce.number().optional() })).optional(),
      }),
    )
    .default([]),
});

const stateSyncValue = z.object({ metadata, state_sync: z.array(z.unknown()).default([]) });

const accountValue = z.object({ event: z.string().min(1).max(100) });

const envelope = z.object({
  entry: z.array(z.object({ changes: z.array(z.object({ field: z.string(), value: z.unknown() })) })),
});

const seconds = (value: string | number | undefined) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const MEDIA_TYPES = new Set<string>(Object.keys(MEDIA_LABELS));

function echoContent(data: z.infer<typeof rawEcho>): EchoContent {
  if (data.type === "text" && data.text) return { type: "text", text: data.text.body };
  if (data.type === "edit" || data.type === "revoke") return { type: "ignored", rawType: data.type };
  if (MEDIA_TYPES.has(data.type)) {
    const mediaType = data.type as MediaType;
    return { type: "media", mediaType, label: MEDIA_LABELS[mediaType] };
  }
  return { type: "unsupported", rawType: data.type };
}

function echoEvents(value: unknown): CoexistenceEvent[] {
  const parsed = echoValue.safeParse(value);
  if (!parsed.success) return [];
  const events: CoexistenceEvent[] = [];
  for (const item of parsed.data.message_echoes) {
    const echo = rawEcho.safeParse(item);
    if (!echo.success) continue;
    const { data } = echo;
    events.push({
      kind: "smb_echo",
      wamid: data.id,
      to: data.to,
      timestamp: seconds(data.timestamp),
      phoneNumberId: parsed.data.metadata.phone_number_id,
      content: echoContent(data),
    });
  }
  return events;
}

function historyEvents(value: unknown): CoexistenceEvent[] {
  const parsed = historyValue.safeParse(value);
  if (!parsed.success) return [];
  return parsed.data.history.map((chunk) => ({
    kind: "history" as const,
    phoneNumberId: parsed.data.metadata.phone_number_id,
    phase: chunk.metadata?.phase ?? null,
    chunk: chunk.metadata?.chunk_order ?? null,
    threads: chunk.threads.length,
    messages: chunk.threads.reduce((sum, thread) => sum + thread.messages.length, 0),
    errorCode: chunk.errors?.[0]?.code ?? null,
    rejected: (chunk.errors?.length ?? 0) > 0,
  }));
}

function stateSyncEvents(value: unknown): CoexistenceEvent[] {
  const parsed = stateSyncValue.safeParse(value);
  if (!parsed.success) return [];
  return [{ kind: "app_state_sync", phoneNumberId: parsed.data.metadata.phone_number_id, contacts: parsed.data.state_sync.length }];
}

function accountEvents(value: unknown): CoexistenceEvent[] {
  const parsed = accountValue.safeParse(value);
  return parsed.success ? [{ kind: "account_update", event: parsed.data.event }] : [];
}

const BY_FIELD: Readonly<Record<string, (value: unknown) => CoexistenceEvent[]>> = {
  smb_message_echoes: echoEvents,
  history: historyEvents,
  smb_app_state_sync: stateSyncEvents,
  account_update: accountEvents,
};

/** Eventos de coexistencia de una notificación de Meta. Campos desconocidos o inválidos se ignoran. */
export function parseCoexistence(payload: unknown): CoexistenceEvent[] {
  const parsed = envelope.safeParse(payload);
  if (!parsed.success) return [];
  const events: CoexistenceEvent[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      const handler = Object.hasOwn(BY_FIELD, change.field) ? BY_FIELD[change.field] : undefined;
      if (handler) events.push(...handler(change.value));
    }
  }
  return events;
}
