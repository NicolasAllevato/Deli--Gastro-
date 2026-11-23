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
  /** Ids de los grupos de opciones del producto (fudo_modifier_groups.fudo_id): promos con bebida a elegir, etc. */
  groups?: number[];
}

/** Grupo de opciones (modificadores de Fudo): lo que el cliente elige dentro de un producto. `id` = fudo_modifier_options.fudo_id. */
export interface OptionGroup {
  name: string;
  min: number | null;
  max: number | null;
  options: { id: number; name: string }[];
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

export type ComplaintCategory = "demora" | "llego_frio" | "faltante" | "pedido_equivocado" | "cobro" | "atencion" | "otro";

export interface ComplaintInput {
  conversationId: string;
  phone: string;
  clientId: string | null;
  /** Lo que contó el cliente (se recorta; en un reclamo ya abierto se agrega al final). */
  motivo: string;
  categoria?: ComplaintCategory;
  /** Pedido reciente al que se vincula (solo si el reclamo no tenía uno). */
  orderId?: string | null;
  /** `consulta`: no es un reclamo sino una pregunta del local sin respuesta (lo usa el turno; el repo lo ignora). Por defecto `reclamo`. */
  kind?: "reclamo" | "consulta";
}

/** Reclamo abierto (abierto o en curso) de una conversación. */
export interface ComplaintTicket {
  id: string;
  /** Número corto que ve el cliente ("reclamo #12"). */
  numero: number;
  /** true = se creó ahora; false = ya había uno abierto y se actualizó (nunca se duplica). */
  created: boolean;
  categoria: ComplaintCategory;
  orderId: string | null;
  fotos: number;
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
  /** Grupos de opciones por id con sus opciones activas (orden por posición). Opcional: sin las tablas o en tests viejos no hay grupos. */
  optionGroups?(): Promise<Record<string, OptionGroup>>;
  /** Carta estructurada activa (vacía = no hay, se usa el menú por categorías). Opcional como `knowledge`. */
  carta?(): Promise<CartaSeccion[]>;
  zones(): Promise<ZoneInfo[]>;
  /** Glosario activo (categoría vocabulario, máx. 30): va al prompt. Opcional: sin la tabla (backend Supabase, tests viejos) no hay glosario. */
  vocabulary?(): Promise<KnowledgeEntry[]>;
  /**
   * Entradas activas de la base de conocimiento (todo menos el vocabulario) que tratan de `query` (lo que el cliente pregunta),
   * las más relevantes primero y como mucho `limit` (8 por defecto). Sin consulta: unas pocas entradas generales. Opcional como `vocabulary`.
   */
  searchKnowledge?(query?: string, limit?: number): Promise<KnowledgeEntry[]>;
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
  /**
   * Reclamo: crea el ticket o, si la conversación ya tiene uno abierto, lo actualiza (motivo, categoría, pedido).
   * Opcional: sin él (backend viejo) la queja se deriva como siempre. null = no se registró nada.
   */
  createComplaint?(input: ComplaintInput): Promise<ComplaintTicket | null>;
  /** Reclamo abierto de la conversación, o null. */
  openComplaint?(conversationId: string): Promise<ComplaintTicket | null>;
  /** Suma la clave de una foto (R2) al reclamo y deja el evento en el historial. */
  addComplaintPhoto?(ticketId: string, key: string): Promise<void>;
  /** Alta/baja de promociones para todas las filas de clientes con ese teléfono; devuelve cuántas cambió. */
  setMarketingOptIn(phone: string, optIn: boolean): Promise<number>;
  saveOutbound(conversationId: string, wamid: string, body: string): Promise<void>;
  /** Guarda la transcripción de un audio para que el panel muestre lo que se escuchó. */
  saveTranscript(wamid: string, text: string): Promise<void>;
}
