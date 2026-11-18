/**
 * Reclamos del bot: SIEMPRE quedan registrados (un ticket por conversación, que se actualiza en vez de duplicarse),
 * se vinculan al pedido más reciente (48 h), se clasifican por categoría y suman las fotos que mande el cliente.
 * Local abierto: ticket + derivación a una persona. Cerrado: ticket sin derivar y aviso de cuándo lo contactan.
 * El aviso al local (mail) lo manda la app: el bot la llama por `/api/internal/bot/reclamo` firmado.
 */
import { categorizarReclamo, faltaDetalle } from "../../../../src/lib/reclamos/categoria.ts";
import type { OrdersClient } from "../orders/client.ts";
import type { BotConversation, BotRepo, ComplaintTicket, OrderInfo } from "../repo/types.ts";

export const RECENT_ORDER_MS = 48 * 60 * 60 * 1000;
const AR_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

export interface ComplaintDeps {
  repo: BotRepo;
  orders?: OrdersClient;
  /** Descarga la foto de Meta y la guarda en R2; devuelve la clave o null. Sin él las fotos no se guardan. */
  storePhoto?: (ticketId: string, mediaId: string) => Promise<string | null>;
  log: (message: string, detail?: unknown) => void;
}

export interface TurnImage {
  wamid: string;
  mediaId: string;
}

export const orderCode = (id: string): string => `#${id.slice(0, 8).toUpperCase()}`;

/** "de hoy" / "de ayer" / "del 12/11" según el día de Buenos Aires. */
export function orderDayLabel(createdAt: Date, now: Date): string {
  const day = (d: Date) => Math.floor((d.getTime() - AR_OFFSET_MS) / DAY_MS);
  const diff = day(now) - day(createdAt);
  if (diff <= 0) return "de hoy";
  if (diff === 1) return "de ayer";
  const local = new Date(createdAt.getTime() - AR_OFFSET_MS);
  return `del ${local.getUTCDate()}/${local.getUTCMonth() + 1}`;
}

/** abierto: deriva a una persona; cerrado: lo contactan al abrir; entrenamiento: no deriva, el local lo revisa. */
export type ComplaintMode = "abierto" | "cerrado" | "entrenamiento";

export interface ReplyParts {
  numero: number;
  mode: ComplaintMode;
  openAt: string;
  order: { code: string; day: string } | null;
  askDetail: boolean;
  askPhoto: boolean;
}

/** Mensaje al registrar un reclamo nuevo. */
export function complaintReply(p: ReplyParts): string {
  const lines = ["Perdón por el mal momento 🙏"];
  if (p.askDetail) lines.push("Contame brevemente qué pasó.");
  if (p.order) lines.push(`¿Es por tu pedido ${p.order.code} ${p.order.day}?`);
  if (p.askPhoto) lines.push("Si podés, mandame una foto del pedido así lo vemos.");
  lines.push(closingLine(p.mode, p.numero, p.openAt));
  return lines.join("\n");
}

function closingLine(mode: ComplaintMode, numero: number, openAt: string): string {
  if (mode === "entrenamiento") return `Ya lo registramos (reclamo #${numero}). El local lo revisa y te escribimos por acá.`;
  if (mode === "abierto") return `Ya lo registramos (reclamo #${numero}). Te escribe alguien del local.`;
  return `Lo registramos (reclamo #${numero}). Te contactamos cuando abramos a las ${openAt}.`;
}

/** Mensaje cuando el cliente suma información o fotos a un reclamo que ya estaba abierto. */
export function complaintUpdateReply(numero: number, mode: ComplaintMode, openAt: string, onlyPhotos: boolean): string {
  const head = onlyPhotos ? `¡Gracias por la foto! La sumé al reclamo #${numero}.` : `Gracias, lo sumé a tu reclamo #${numero}.`;
  if (mode === "entrenamiento") return `${head} El local lo revisa y te escribimos por acá.`;
  return mode === "abierto" ? `${head} Te escribe alguien del local.` : `${head} Te contactamos cuando abramos a las ${openAt}.`;
}

/** ¿El último mensaje del bot es el aviso de un reclamo? (el cliente está contestando sobre su reclamo). */
export const isComplaintReply = (body: string | null | undefined): boolean => !!body && /\breclamo #\d+/.test(body);

/** Saca las marcas de foto del texto combinado del turno. */
export const withoutPhotoMarks = (text: string): string => text.replace(/^\[foto\]\s*/gm, "").trim();

async function recentOrder(repo: BotRepo, clientId: string | null, now: Date): Promise<OrderInfo | null> {
  if (!clientId) return null;
  const order = await repo.latestOrder(clientId).catch(() => null);
  return order && now.getTime() - order.createdAt.getTime() <= RECENT_ORDER_MS ? order : null;
}

/** Guarda las fotos del turno en el reclamo. Una que falla no corta el resto ni el reclamo. */
export async function attachPhotos(deps: ComplaintDeps, ticket: ComplaintTicket, images: readonly TurnImage[]): Promise<number> {
  if (!deps.storePhoto || !deps.repo.addComplaintPhoto || images.length === 0) return 0;
  let saved = 0;
  for (const image of images) {
    try {
      const key = await deps.storePhoto(ticket.id, image.mediaId);
      if (!key) continue;
      await deps.repo.addComplaintPhoto(ticket.id, key);
      saved += 1;
    } catch (error: unknown) {
      deps.log("[whatsapp-bot] no se pudo guardar la foto del reclamo", { ticket: ticket.id, error: error instanceof Error ? error.message : "error" });
    }
  }
  return saved;
}

/**
 * Avisa a la app que el reclamo es nuevo o cambió: la app manda el mail al local (una sola vez) y le pide al agente
 * de reclamos una sugerencia nueva. Si falla, el reclamo queda igual y la sugerencia se pide desde el panel.
 */
export async function pingApp(deps: ComplaintDeps, conversationId: string, ticketId: string, inboundWamid: string | undefined): Promise<void> {
  if (!inboundWamid || !deps.orders?.reclamo) return;
  const sent = await deps.orders.reclamo({ conversationId, inboundWamid, reclamoId: ticketId }).catch(() => null);
  if (!sent?.ok) deps.log("[whatsapp-bot] no se pudo avisar el reclamo a la app", { ticket: ticketId, code: sent && !sent.ok ? sent.code : "error" });
}

export interface Registered {
  ticket: ComplaintTicket;
  text: string;
}

/**
 * Registra (o actualiza) el reclamo de la conversación y arma la respuesta. null si el repo no soporta reclamos.
 * Un reclamo NUEVO dispara el aviso al local por la app (si falla queda en el panel igual).
 */
export async function registerComplaint(
  deps: ComplaintDeps,
  conversation: BotConversation,
  input: { text: string; images: readonly TurnImage[]; inboundWamid: string | undefined; mode: ComplaintMode; openAt: string },
  now: Date = new Date(),
): Promise<Registered | null> {
  if (!deps.repo.createComplaint) return null;
  const before = (await deps.repo.openComplaint?.(conversation.id).catch(() => null)) ?? null;
  const order = before?.orderId ? null : await recentOrder(deps.repo, conversation.clientId, now);
  const clean = withoutPhotoMarks(input.text);
  const ticket = await deps.repo.createComplaint({
    conversationId: conversation.id,
    phone: conversation.phone,
    clientId: conversation.clientId,
    motivo: clean || "Foto del pedido",
    categoria: categorizarReclamo(clean),
    orderId: order?.id ?? null,
  });
  if (!ticket) return null;
  const photos = await attachPhotos(deps, ticket, input.images);

  await pingApp(deps, conversation.id, ticket.id, input.inboundWamid);

  const text = ticket.created
    ? complaintReply({
        numero: ticket.numero,
        mode: input.mode,
        openAt: input.openAt,
        order: order ? { code: orderCode(order.id), day: orderDayLabel(order.createdAt, now) } : null,
        askDetail: faltaDetalle(clean),
        askPhoto: ticket.fotos + photos === 0,
      })
    : complaintUpdateReply(ticket.numero, input.mode, input.openAt, clean.length === 0 && photos > 0);
  return { ticket, text };
}
