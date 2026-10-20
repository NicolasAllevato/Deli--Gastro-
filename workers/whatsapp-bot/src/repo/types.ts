/**
 * Contratos de acceso a la base del bot, sin importar `postgres`: los tests y el typecheck de la raíz
 * los usan sin tener instaladas las dependencias del Worker.
 */
import type { DeliveryStatus } from "../../../../src/lib/whatsapp/payload.ts";

export interface StoredConversation {
  id: string;
  phone: string;
  /** true = un humano tomó la conversación desde el panel: el bot no responde. */
  humanTakeover: boolean;
}

export interface InboundRow {
  wamid: string;
  type: "text" | "audio" | "unsupported";
  body: string | null;
}

/** Acceso a la base para la entrada de mensajes (SQL en producción, memoria en los tests). */
export interface InboundRepo {
  upsertConversation(phone: string, name: string | null): Promise<StoredConversation>;
  /** Guarda el mensaje entrante; false si ese wamid ya estaba (reintento de Meta). */
  saveInbound(conversationId: string, message: InboundRow): Promise<boolean>;
  updateStatus(wamid: string, status: DeliveryStatus): Promise<void>;
}

export interface BotConversation {
  id: string;
  phone: string;
  clientId: string | null;
  /** Nombre del cliente registrado o, si no hay, el del perfil de WhatsApp. */
  displayName: string | null;
  humanTakeover: boolean;
}

export interface HistoryItem {
  direction: "in" | "out";
  body: string;
}

export interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  price: number;
  category: string;
}

export interface ZoneInfo {
  name: string;
  fee: number;
  minOrder: number;
}

export interface OrderInfo {
  id: string;
  status: string;
  itemsDesc: string;
  total: number;
  courierName: string | null;
  createdAt: Date;
}

/** Acceso a la base del bot (respondedores). SQL en producción, memoria en los tests. */
export interface BotRepo {
  getConversation(phone: string): Promise<BotConversation | null>;
  /** Últimos mensajes con texto, del más viejo al más nuevo. */
  history(conversationId: string, limit: number): Promise<HistoryItem[]>;
  inboundCounts(conversationId: string): Promise<{ lastMinute: number; lastDay: number }>;
  config(): Promise<Record<string, unknown>>;
  menu(): Promise<MenuItem[]>;
  zones(): Promise<ZoneInfo[]>;
  latestOrder(clientId: string): Promise<OrderInfo | null>;
  setTakeover(conversationId: string): Promise<void>;
  /** Alta/baja de promociones para todas las filas de clientes con ese teléfono; devuelve cuántas cambió. */
  setMarketingOptIn(phone: string, optIn: boolean): Promise<number>;
  saveOutbound(conversationId: string, wamid: string, body: string): Promise<void>;
  /** Guarda la transcripción de un audio para que el panel muestre lo que se escuchó. */
  saveTranscript(wamid: string, text: string): Promise<void>;
}
