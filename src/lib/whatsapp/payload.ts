import { z } from "zod";

export type InboundContent =
  | { type: "text"; text: string }
  | { type: "audio"; mediaId: string; mimeType: string }
  | { type: "unsupported"; rawType: string };

export interface InboundMessage {
  kind: "message";
  wamid: string;
  from: string;
  name: string | null;
  timestamp: number;
  phoneNumberId: string;
  content: InboundContent;
}

export type DeliveryStatus = "sent" | "delivered" | "read" | "failed";

export interface StatusEvent {
  kind: "status";
  wamid: string;
  status: DeliveryStatus;
  recipient: string;
  timestamp: number;
}

/** Mensaje que salió del número del local (hoy solo lo informa OpenWA, incluso si se escribió en el teléfono). */
export interface OutboundEcho {
  kind: "echo";
  wamid: string;
  to: string;
  timestamp: number;
  phoneNumberId: string;
  content: InboundContent;
}

export type WebhookEvent = InboundMessage | StatusEvent | OutboundEcho;

const rawMessage = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  timestamp: z.string().optional(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  audio: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
  interactive: z
    .object({
      button_reply: z.object({ title: z.string() }).optional(),
      list_reply: z.object({ title: z.string() }).optional(),
    })
    .optional(),
  button: z.object({ text: z.string() }).optional(),
});

const rawStatus = z.object({
  id: z.string().min(1),
  status: z.enum(["sent", "delivered", "read", "failed"]),
  recipient_id: z.string().default(""),
  timestamp: z.string().optional(),
});

const rawValue = z.object({
  metadata: z.object({ phone_number_id: z.string() }),
  contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string() }).optional() })).optional(),
  messages: z.array(z.unknown()).optional(),
  statuses: z.array(z.unknown()).optional(),
});

const rawEnvelope = z.object({
  entry: z.array(z.object({ changes: z.array(z.object({ value: z.unknown() })) })),
});

function contentOf(msg: z.infer<typeof rawMessage>): InboundContent {
  if (msg.type === "text" && msg.text) return { type: "text", text: msg.text.body };
  if (msg.type === "audio" && msg.audio) {
    return { type: "audio", mediaId: msg.audio.id, mimeType: msg.audio.mime_type ?? "audio/ogg" };
  }
  if (msg.type === "interactive") {
    const title = msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title;
    if (title) return { type: "text", text: title };
  }
  if (msg.type === "button" && msg.button) return { type: "text", text: msg.button.text };
  return { type: "unsupported", rawType: msg.type };
}

const seconds = (value: string | undefined) => Number(value) || 0;

/** Mensajes entrantes y estados de entrega de una notificación de Meta. Lo inválido se descarta. */
export function parseWebhook(payload: unknown): WebhookEvent[] {
  const envelope = rawEnvelope.safeParse(payload);
  if (!envelope.success) return [];

  const events: WebhookEvent[] = [];
  for (const entry of envelope.data.entry) {
    for (const change of entry.changes) {
      const value = rawValue.safeParse(change.value);
      if (!value.success) continue;
      const { metadata, contacts = [], messages = [], statuses = [] } = value.data;
      const names = new Map(contacts.map((c) => [c.wa_id, c.profile?.name ?? null]));

      for (const item of messages) {
        const msg = rawMessage.safeParse(item);
        if (!msg.success) continue;
        events.push({
          kind: "message",
          wamid: msg.data.id,
          from: msg.data.from,
          name: names.get(msg.data.from) ?? null,
          timestamp: seconds(msg.data.timestamp),
          phoneNumberId: metadata.phone_number_id,
          content: contentOf(msg.data),
        });
      }

      for (const item of statuses) {
        const status = rawStatus.safeParse(item);
        if (!status.success) continue;
        events.push({
          kind: "status",
          wamid: status.data.id,
          status: status.data.status,
          recipient: status.data.recipient_id,
          timestamp: seconds(status.data.timestamp),
        });
      }
    }
  }
  return events;
}
