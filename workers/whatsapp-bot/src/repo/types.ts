/**
 * Contratos de acceso a la base del bot, sin importar `postgres`: los tests y el typecheck de la raíz
 * los usan sin tener instaladas las dependencias del Worker.
 */
import type { DeliveryStatus } from "../../../../src/lib/whatsapp/payload.ts";

export interface StoredConversation {
  id: string;
  phone: string;
  /** true = un humano tomó la conversación (panel, o app WhatsApp Business con pausa vigente): el bot no responde. */
  humanTakeover: boolean;
}

export interface InboundRow {
  wamid: string;
  type: "text" | "audio" | "unsupported" | "image" | "video" | "document";
  body: string | null;
}

/** Acceso a la base para la entrada de mensajes (SQL en producción, memoria en los tests). */
export interface InboundRepo {
  upsertConversation(phone: string, name: string | null): Promise<StoredConversation>;
  /** Guarda el mensaje entrante; false si ese wamid ya estaba (reintento de Meta). */
  saveInbound(conversationId: string, message: InboundRow): Promise<boolean>;
  updateStatus(wamid: string, status: DeliveryStatus): Promise<void>;
  /** true si ese wamid ya está guardado como saliente (eco repetido o mensaje que mandó el propio bot). */
  hasOutbound(wamid: string): Promise<boolean>;
  /**
   * Conversación del teléfono comparando los últimos 10 dígitos (AR mezcla 549.../54...); la crea solo si no hay ninguna.
   * No toca `last_inbound_at`: un eco no es un mensaje del cliente (un chat creado así queda con `last_inbound_at` nulo).
   */
  ensureConversation(phone: string): Promise<StoredConversation>;
  /**
   * Pausa el bot hasta `until` en la conversación y en TODAS las que comparten sus últimos 10 dígitos (fail-closed);
   * nunca acorta una pausa más larga. Devuelve cuántas filas pausó.
   */
  pauseBot(conversationId: string, until: Date): Promise<number>;
  /** Guarda el eco como mensaje saliente del local; false si ese wamid ya estaba (reintento de Meta). */
  saveEcho(conversationId: string, message: InboundRow): Promise<boolean>;
  /** Minutos de pausa tras un eco (`bot_human_takeover_minutes`, 120 por defecto). */
  takeoverMinutes(): Promise<number>;
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

/** Línea de la carta estructurada (carta impresa): precio vivo del producto vinculado; null = sin precio. */
export interface CartaLinea {
  nombre: string;
  nota: string | null;
  productos: ({ id: string; price: number } | null)[];
}

export interface CartaSeccion {
  titulo: string;
  columnas: string[];
  estilo: "lista" | "gustos";
  nota: string | null;
  items: CartaLinea[];
}

export interface ZoneInfo {
  name: string;
  fee: number;
  minOrder: number;
}

/** Entrada activa de la base de conocimiento del negocio (`kb_negocio`, la carga el admin). */
export interface KnowledgeEntry {
  category: "faq" | "politica" | "promo" | "vocabulario" | "otro";
  topic: string;
  content: string;
}

export interface OrderInfo {
  id: string;
  status: string;
  itemsDesc: string;
  total: number;
  courierName: string | null;
  createdAt: Date;
}

/**
 * Perfil del cliente habitual (etapa 2), derivado en vivo de clients/orders/order_items por los últimos 10 dígitos
 * del teléfono. Solo se usa en la conversación de ese mismo teléfono. Sin medio de pago, a propósito.
 */
export interface CustomerProfile {
  name: string | null;
  /** Pedidos no cancelados. */
  orderCount: number;
  /** Hasta 3 productos más pedidos (por cantidad) en los últimos 20 pedidos. */
  topProducts: string[];
  /** Dirección del último pedido no cancelado con dirección. Nunca se usa sin que el cliente la confirme. */
  lastAddress: string | null;
}

export interface ComplaintInput {
  conversationId: string;
  phone: string;
  clientId: string | null;
  /** Lo que contó el cliente (se recorta a 500 caracteres). */
  motivo: string;
}

/** Acceso a la base del bot (respondedores). SQL en producción, memoria en los tests. */
export interface BotRepo {
  getConversation(phone: string): Promise<BotConversation | null>;
  /** Últimos mensajes con texto, del más viejo al más nuevo. */
  history(conversationId: string, limit: number): Promise<HistoryItem[]>;
  inboundCounts(conversationId: string): Promise<{ lastMinute: number; lastDay: number }>;
  config(): Promise<Record<string, unknown>>;
  menu(): Promise<MenuItem[]>;
  /** Carta estructurada activa (vacía = no hay, se usa el menú por categorías). Opcional como `knowledge`. */
  carta?(): Promise<CartaSeccion[]>;
  zones(): Promise<ZoneInfo[]>;
  /** Base de conocimiento activa. Opcional: sin la tabla (backend Supabase, tests viejos) no hay conocimiento extra. */
  knowledge?(): Promise<KnowledgeEntry[]>;
  /** Correcciones de errores aprobados (kb_errores): "Errores a evitar" en el prompt. Opcional como `knowledge`. */
  lessons?(): Promise<string[]>;
  latestOrder(clientId: string): Promise<OrderInfo | null>;
  /** Perfil del cliente habitual de ESE teléfono; null si es nuevo. Opcional: sin él, nada cambia. */
  customerProfile?(phone: string): Promise<CustomerProfile | null>;
  setTakeover(conversationId: string): Promise<void>;
  /**
   * Cuándo mandó el bot (o el local) el último mensaje de esta conversación; null si nunca. Decide el saludo de
   * bienvenida. Opcional: sin él (backend viejo, tests) no se saluda aparte.
   */
  lastOutboundAt?(conversationId: string): Promise<Date | null>;
  /** Ticket de reclamo (local cerrado: no hay a quién derivar). Opcional: sin él se deriva como siempre. */
  createComplaint?(input: ComplaintInput): Promise<void>;
  /** Alta/baja de promociones para todas las filas de clientes con ese teléfono; devuelve cuántas cambió. */
  setMarketingOptIn(phone: string, optIn: boolean): Promise<number>;
  saveOutbound(conversationId: string, wamid: string, body: string): Promise<void>;
  /** Guarda la transcripción de un audio para que el panel muestre lo que se escuchó. */
  saveTranscript(wamid: string, text: string): Promise<void>;
}
