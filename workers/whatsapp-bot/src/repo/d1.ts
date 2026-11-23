/**
 * Etapa 2 del corte: repos del bot sobre D1 (DATA_BACKEND=d1), con el mismo contrato que los de
 * Postgres (repo/bot.ts y repo/inbound.ts). SQLite: fechas ISO en UTC comparadas como texto, montos
 * en centavos, phone_digits (últimos 10 dígitos, lo mantiene la app) en vez de regexp_replace.
 * Todos los valores van con bind(); no se arma SQL con datos.
 */
import type { SqlDatabase } from "../../../../src/lib/data/sql.ts";
import { fromCents } from "../../../../src/lib/data/money.ts";
import { TAKEOVER_KEY, takeoverMinutesFromConfig } from "../bot/settings.ts";
import { phoneTail, resolveMatches } from "./phone-tail.ts";
import { buildFtsQuery, likePatterns, NO_QUERY_LIMIT, SEARCH_LIMIT } from "./kb-search.ts";
import type { BotRepo, CartaSeccion, ComplaintCategory, ComplaintTicket, HistoryItem, InboundRepo, KnowledgeEntry, OptionGroup } from "./types.ts";

type Log = (message: string, detail?: unknown) => void;
type ConvRow = { id: string; client_phone: string; silenced: number };

const MENU_LIMIT = 200;
/** Tope del glosario que va al prompt. */
const VOCABULARY_LIMIT = 30;
const now = () => new Date().toISOString();

type CartaRow = {
  sid: string; titulo: string; columnas: string; estilo: string; snota: string | null;
  nombre: string; nota: string | null;
  p1: string | null; p1_price: number | null; p2: string | null; p2_price: number | null;
};

/** Carta estructurada (migración 0015) con precios vivos de productos activos. Sin la tabla: carta vacía. */
async function cartaD1(db: SqlDatabase): Promise<CartaSeccion[]> {
  let rows: CartaRow[];
  try {
    rows = (
      await db
        .prepare(
          `SELECT s.id AS sid, s.titulo, s.columnas, s.estilo, s.nota AS snota, i.nombre, i.nota,
                  p1.id AS p1, p1.price_cents AS p1_price, p2.id AS p2, p2.price_cents AS p2_price
           FROM carta_secciones s
           JOIN carta_items i ON i.seccion_id = s.id AND i.activo = 1
           LEFT JOIN products p1 ON p1.id = i.producto_id AND p1.is_active = 1
           LEFT JOIN products p2 ON p2.id = i.producto_id_2 AND p2.is_active = 1
           WHERE s.activo = 1 ORDER BY s.orden, s.titulo, i.orden, i.nombre LIMIT ?`,
        )
        .bind(MENU_LIMIT)
        .all<CartaRow>()
    ).results;
  } catch (err: unknown) {
    if (err instanceof Error && /no such table/i.test(err.message)) return [];
    throw err;
  }
  const out: CartaSeccion[] = [];
  const bySection = new Map<string, CartaSeccion>();
  for (const r of rows) {
    let s = bySection.get(r.sid);
    if (!s) {
      let columnas: string[] = [];
      try {
        const parsed: unknown = JSON.parse(r.columnas);
        if (Array.isArray(parsed)) columnas = parsed.filter((c): c is string => typeof c === "string").slice(0, 2);
      } catch {
        columnas = [];
      }
      s = { titulo: r.titulo, columnas, estilo: r.estilo === "gustos" ? "gustos" : "lista", nota: r.snota, items: [] };
      bySection.set(r.sid, s);
      out.push(s);
    }
    const ref = (id: string | null, cents: number | null) => (id && cents !== null ? { id, price: fromCents(cents) } : null);
    const productos = [ref(r.p1, r.p1_price), ref(r.p2, r.p2_price)].slice(0, Math.max(1, s.columnas.length));
    // Sin producto (o inactivo) la línea no se ofrece: el bot no muestra lo que no se puede pedir.
    if (productos.some((p) => p !== null)) s.items = [...s.items, { nombre: r.nombre, nota: r.nota, productos }];
  }
  return out.filter((s) => s.items.length > 0);
}

/** Ids de grupos de opciones por producto del menú (products.fudo_id → fudo_product_groups). Sin las tablas o con error: sin grupos. */
async function productGroupsD1(db: SqlDatabase): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  try {
    const { results } = await db
      .prepare(
        `SELECT p.id AS id, g.group_fudo_id AS gid
         FROM products p JOIN fudo_product_groups g ON g.product_fudo_id = p.fudo_id
         WHERE p.is_active = 1 AND COALESCE(p.show_in_portal, 1) = 1 ORDER BY p.id, g.group_fudo_id LIMIT ?`,
      )
      .bind(MENU_LIMIT * 4)
      .all<{ id: string; gid: number }>();
    for (const r of results) out.set(r.id, [...(out.get(r.id) ?? []), r.gid]);
  } catch {
    return new Map();
  }
  return out;
}

/** Grupos con opciones activas (id de opción = fudo_modifier_options.fudo_id). Sin las tablas o con error: sin grupos. */
async function optionGroupsD1(db: SqlDatabase): Promise<Record<string, OptionGroup>> {
  try {
    const { results } = await db
      .prepare(
        `SELECT g.fudo_id AS gid, g.name AS gname, g.min_qty, g.max_qty, o.fudo_id AS oid, o.name AS oname
         FROM fudo_modifier_groups g JOIN fudo_modifier_options o ON o.group_fudo_id = g.fudo_id AND o.is_active = 1
         ORDER BY g.fudo_id, o.position, o.name LIMIT ?`,
      )
      .bind(MENU_LIMIT * 4)
      .all<{ gid: number; gname: string; min_qty: number | null; max_qty: number | null; oid: number; oname: string }>();
    const out: Record<string, OptionGroup> = {};
    for (const r of results) {
      const g = out[String(r.gid)] ?? { name: r.gname, min: r.min_qty, max: r.max_qty, options: [] };
      out[String(r.gid)] = { ...g, options: [...g.options, { id: r.oid, name: r.oname }] };
    }
    return out;
  } catch {
    return {};
  }
}

/** Conversaciones con los mismos 10 dígitos, la de actividad más reciente primero. */
async function matching(db: SqlDatabase, phone: string) {
  const { results } = await db
    .prepare(
      `SELECT id, client_phone, (human_takeover = 1 OR coalesce(bot_paused_until > ?, 0)) AS silenced
       FROM wa_conversations WHERE substr(client_phone, -10) = ?
       ORDER BY coalesce(last_inbound_at, created_at) DESC, created_at DESC`,
    )
    .bind(now(), phoneTail(phone))
    .all<ConvRow>();
  return results.map((r) => ({ ...r, silenced: Boolean(r.silenced) }));
}

/** Cliente con el mismo teléfono (últimos 10 dígitos), el más antiguo. */
async function clientByPhone(db: SqlDatabase, phone: string): Promise<string | null> {
  const tail = phoneTail(phone);
  if (tail.length !== 10) return null;
  const row = await db.prepare("SELECT id FROM clients WHERE phone_digits = ? ORDER BY created_at LIMIT 1").bind(tail).first<{ id: string }>();
  return row?.id ?? null;
}

const stored = (row: { id: string; client_phone: string }, silenced: boolean) => ({ id: row.id, phone: row.client_phone, humanTakeover: silenced });

export function d1InboundRepo(db: SqlDatabase, log: Log = () => {}): InboundRepo {
  const warnDuplicates = (count: number) => {
    if (count > 0) log("[whatsapp-bot] varias conversaciones comparten el teléfono (últimos 10 dígitos)", { duplicates: count });
  };
  return {
    async upsertConversation(phone, name) {
      const found = resolveMatches(await matching(db, phone));
      const clientId = await clientByPhone(db, phone);
      if (found) {
        warnDuplicates(found.duplicates);
        await db
          .prepare("UPDATE wa_conversations SET contact_name = coalesce(contact_name, ?), client_id = coalesce(client_id, ?), last_inbound_at = ? WHERE id = ?")
          .bind(name, clientId, now(), found.primary.id)
          .run();
        return stored(found.primary, found.silenced);
      }
      // Atómico: dos mensajes simultáneos del mismo teléfono no crean dos conversaciones (UNIQUE client_phone).
      const row = await db
        .prepare(
          `INSERT INTO wa_conversations (id, client_phone, contact_name, client_id, last_inbound_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (client_phone) DO UPDATE SET contact_name = coalesce(wa_conversations.contact_name, excluded.contact_name),
             client_id = coalesce(wa_conversations.client_id, excluded.client_id), last_inbound_at = excluded.last_inbound_at
           RETURNING id, client_phone, (human_takeover = 1 OR coalesce(bot_paused_until > ?, 0)) AS silenced`,
        )
        .bind(crypto.randomUUID(), phone, name, clientId, now(), now())
        .first<ConvRow>();
      if (!row) throw new Error("no se pudo guardar la conversación");
      return stored(row, Boolean(row.silenced));
    },

    async hasOutbound(wamid) {
      return Boolean(await db.prepare("SELECT 1 AS x FROM wa_messages WHERE wamid = ? AND direction = 'out' LIMIT 1").bind(wamid).first());
    },

    async ensureConversation(phone) {
      let found = resolveMatches(await matching(db, phone));
      if (!found) {
        await db
          .prepare("INSERT INTO wa_conversations (id, client_phone, client_id) VALUES (?, ?, ?) ON CONFLICT (client_phone) DO NOTHING")
          .bind(crypto.randomUUID(), phone, await clientByPhone(db, phone))
          .run();
        found = resolveMatches(await matching(db, phone));
      }
      if (!found) throw new Error("no se pudo crear la conversación del eco");
      warnDuplicates(found.duplicates);
      return stored(found.primary, found.silenced);
    },

    async pauseBot(conversationId, until) {
      // Fail-closed: pausa TODAS las conversaciones con los mismos 10 dígitos; nunca acorta una pausa más larga.
      const iso = until.toISOString();
      const r = await db
        .prepare(
          `UPDATE wa_conversations SET bot_paused_until = CASE WHEN bot_paused_until IS NULL OR bot_paused_until < ? THEN ? ELSE bot_paused_until END
           WHERE substr(client_phone, -10) = (SELECT substr(client_phone, -10) FROM wa_conversations WHERE id = ?)`,
        )
        .bind(iso, iso, conversationId)
        .run();
      return r.meta.changes;
    },

    async saveEcho(conversationId, message) {
      const r = await db
        .prepare("INSERT INTO wa_messages (id, conversation_id, wamid, direction, type, body, status) VALUES (?, ?, ?, 'out', ?, ?, 'sent') ON CONFLICT (wamid) DO NOTHING")
        .bind(crypto.randomUUID(), conversationId, message.wamid, message.type, message.body)
        .run();
      return r.meta.changes > 0;
    },

    async takeoverMinutes() {
      const row = await db.prepare("SELECT value FROM global_config WHERE key = ?").bind(TAKEOVER_KEY).first<{ value: string }>();
      return takeoverMinutesFromConfig({ [TAKEOVER_KEY]: row ? JSON.parse(row.value) : undefined });
    },

    async saveInbound(conversationId, message) {
      const r = await db
        .prepare("INSERT INTO wa_messages (id, conversation_id, wamid, direction, type, body) VALUES (?, ?, ?, 'in', ?, ?) ON CONFLICT (wamid) DO NOTHING")
        .bind(crypto.randomUUID(), conversationId, message.wamid, message.type, message.body)
        .run();
      return r.meta.changes > 0;
    },

    async updateStatus(wamid, status) {
      await db.prepare("UPDATE wa_messages SET status = ? WHERE wamid = ?").bind(status, wamid).run();
    },
  };
}

export function d1BotRepo(db: SqlDatabase, log: Log = () => {}): BotRepo {
  return {
    async getConversation(phone) {
      const { results } = await db
        .prepare(
          `SELECT c.id, c.client_phone, c.client_id, coalesce(cl.name, c.contact_name) AS name,
             (c.human_takeover = 1 OR coalesce(c.bot_paused_until > ?, 0)) AS silenced
           FROM wa_conversations c LEFT JOIN clients cl ON cl.id = c.client_id
           WHERE substr(c.client_phone, -10) = ?
           ORDER BY coalesce(c.last_inbound_at, c.created_at) DESC, c.created_at DESC`,
        )
        .bind(now(), phoneTail(phone))
        .all<{ id: string; client_phone: string; client_id: string | null; name: string | null; silenced: number }>();
      const found = resolveMatches(results.map((r) => ({ ...r, silenced: Boolean(r.silenced) })));
      if (!found) return null;
      if (found.duplicates > 0) log("[whatsapp-bot] varias conversaciones comparten el teléfono (últimos 10 dígitos)", { duplicates: found.duplicates });
      const { primary } = found;
      return { id: primary.id, phone: primary.client_phone, clientId: primary.client_id, displayName: primary.name, humanTakeover: found.silenced };
    },

    async history(conversationId, limit) {
      const { results } = await db
        .prepare("SELECT direction, body FROM wa_messages WHERE conversation_id = ? AND body IS NOT NULL ORDER BY created_at DESC LIMIT ?")
        .bind(conversationId, limit)
        .all<HistoryItem>();
      return results.reverse();
    },

    async inboundCounts(conversationId) {
      const t = Date.now();
      const minuteAgo = new Date(t - 60_000).toISOString();
      const dayAgo = new Date(t - 86_400_000).toISOString();
      const row = await db
        .prepare(
          `SELECT coalesce(sum(CASE WHEN created_at > ? THEN 1 ELSE 0 END), 0) AS last_minute, count(*) AS last_day
           FROM wa_messages WHERE conversation_id = ? AND direction = 'in' AND created_at > ?`,
        )
        .bind(minuteAgo, conversationId, dayAgo)
        .first<{ last_minute: number; last_day: number }>();
      return { lastMinute: Number(row?.last_minute ?? 0), lastDay: Number(row?.last_day ?? 0) };
    },

    async config() {
      const { results } = await db.prepare("SELECT key, value FROM global_config").all<{ key: string; value: string }>();
      return Object.fromEntries(results.map((r) => [r.key, JSON.parse(r.value)]));
    },

    async menu() {
      const { results } = await db
        .prepare(
          `SELECT p.id, p.name, p.description, p.price_cents, c.name AS category
           FROM products p LEFT JOIN categories c ON c.id = p.category_id
           WHERE p.is_active = 1 AND COALESCE(p.show_in_portal, 1) = 1 ORDER BY c.name IS NULL, c.name, p.name LIMIT ?`,
        )
        .bind(MENU_LIMIT)
        .all<{ id: string; name: string; description: string | null; price_cents: number; category: string | null }>();
      const groupsByProduct = await productGroupsD1(db);
      return results.map((r) => {
        const groups = groupsByProduct.get(r.id);
        return { id: r.id, name: r.name, description: r.description, price: fromCents(r.price_cents), category: r.category ?? "Otros", ...(groups ? { groups } : {}) };
      });
    },

    async optionGroups() {
      return optionGroupsD1(db);
    },

    async carta() {
      return cartaD1(db);
    },

    async zones() {
      const { results } = await db
        .prepare("SELECT name, fee_cents, min_order_cents FROM delivery_zones WHERE is_active = 1 ORDER BY sort_order")
        .all<{ name: string; fee_cents: number; min_order_cents: number }>();
      return results.map((r) => ({ name: r.name, fee: fromCents(r.fee_cents), minOrder: fromCents(r.min_order_cents) }));
    },

    async vocabulary() {
      const { results } = await db
        .prepare("SELECT categoria, tema, contenido FROM kb_negocio WHERE activo = 1 AND categoria = 'vocabulario' ORDER BY orden, tema LIMIT ?")
        .bind(VOCABULARY_LIMIT)
        .all<KbRow>();
      return results.map(toKnowledge);
    },

    async searchKnowledge(query = "", limit = SEARCH_LIMIT) {
      return searchKnowledgeD1(db, query, limit, log);
    },

    async lessons() {
      const { results } = await db
        .prepare("SELECT correccion FROM kb_errores WHERE estado = 'aprobada' ORDER BY veces DESC, updated_at DESC LIMIT 20")
        .all<{ correccion: string }>();
      return results.map((r) => r.correccion);
    },

    async latestOrder(clientId) {
      const row = await db
        .prepare("SELECT id, status, items_desc, total_cents, courier_name, created_at FROM orders WHERE client_id = ? ORDER BY created_at DESC LIMIT 1")
        .bind(clientId)
        .first<{ id: string; status: string; items_desc: string; total_cents: number; courier_name: string | null; created_at: string }>();
      return row
        ? { id: row.id, status: row.status, itemsDesc: row.items_desc, total: fromCents(row.total_cents), courierName: row.courier_name, createdAt: new Date(row.created_at) }
        : null;
    },

    async customerProfile(phone) {
      const tail = phoneTail(phone);
      if (tail.length !== 10) return null;
      // Todo por phone_digits: el perfil es siempre del mismo teléfono de la conversación, nunca de otro cliente.
      const owned = "SELECT id FROM clients WHERE phone_digits = ? AND is_anonymous = 0";
      const head = await db
        .prepare(
          `SELECT (SELECT name FROM clients WHERE phone_digits = ? AND is_anonymous = 0 ORDER BY created_at LIMIT 1) AS name,
             (SELECT count(*) FROM orders WHERE client_id IN (${owned}) AND status <> 'Cancelado') AS order_count,
             (SELECT delivery_address FROM orders WHERE client_id IN (${owned}) AND status <> 'Cancelado'
                AND delivery_address IS NOT NULL AND trim(delivery_address) <> '' ORDER BY created_at DESC LIMIT 1) AS last_address`,
        )
        .bind(tail, tail, tail)
        .first<{ name: string | null; order_count: number; last_address: string | null }>();
      const orderCount = Number(head?.order_count ?? 0);
      if (!head || (!head.name && orderCount === 0)) return null;
      const { results } = await db
        .prepare(
          `SELECT oi.name AS name, sum(oi.qty) AS qty FROM order_items oi
           WHERE oi.order_id IN (SELECT id FROM orders WHERE client_id IN (${owned}) AND status <> 'Cancelado' ORDER BY created_at DESC LIMIT 20)
           GROUP BY oi.name ORDER BY qty DESC, oi.name LIMIT 3`,
        )
        .bind(tail)
        .all<{ name: string; qty: number }>();
      return { name: head.name, orderCount, topProducts: results.map((r) => r.name), lastAddress: head.last_address };
    },

    async lastOutboundAt(conversationId) {
      const row = await db
        .prepare("SELECT max(created_at) AS at FROM wa_messages WHERE conversation_id = ? AND direction = 'out'")
        .bind(conversationId)
        .first<{ at: string | null }>();
      return row?.at ? new Date(row.at) : null;
    },

    async openComplaint(conversationId) {
      return openComplaintD1(db, conversationId);
    },

    async createComplaint({ conversationId, phone, clientId, motivo, categoria, orderId }) {
      const text = motivo.replace(/\s+/g, " ").trim().slice(0, 500) || "Reclamo sin detalle";
      const cat = categoria ?? "otro";
      const now = new Date().toISOString();
      const open = await openComplaintD1(db, conversationId);
      if (open) {
        // Un solo reclamo abierto por conversación: se suma lo nuevo (sin repetir) y se completa lo que faltaba.
        await db.batch([
          db
            .prepare(
              `UPDATE reclamos SET motivo = CASE WHEN instr(motivo, ?1) > 0 THEN motivo ELSE substr(motivo || char(10) || ?1, 1, 1000) END,
                 categoria = CASE WHEN categoria = 'otro' THEN ?2 ELSE categoria END,
                 order_id = coalesce(order_id, ?3), client_id = coalesce(client_id, ?4), updated_at = ?5
               WHERE id = ?6`,
            )
            .bind(text, cat, orderId ?? null, clientId, now, open.id),
          db
            .prepare("INSERT INTO reclamos_eventos (id, reclamo_id, tipo, detalle, autor, created_at) VALUES (?, ?, 'actualizado', ?, 'bot', ?)")
            .bind(crypto.randomUUID(), open.id, text, now),
        ]);
        return { ...(await openComplaintD1(db, conversationId))!, created: false };
      }
      const id = crypto.randomUUID();
      await db.batch([
        db
          .prepare(
            `INSERT INTO reclamos (id, numero, conversation_id, client_phone, client_id, order_id, categoria, motivo, created_at, updated_at)
             VALUES (?, (SELECT coalesce(max(numero), 0) + 1 FROM reclamos), ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(id, conversationId, phone, clientId, orderId ?? null, cat, text, now, now),
        db
          .prepare("INSERT INTO reclamos_eventos (id, reclamo_id, tipo, detalle, autor, created_at) VALUES (?, ?, 'creado', ?, 'bot', ?)")
          .bind(crypto.randomUUID(), id, text, now),
      ]);
      const created = await openComplaintD1(db, conversationId);
      return created ? { ...created, created: true } : null;
    },

    async addComplaintPhoto(ticketId, key) {
      const now = new Date().toISOString();
      await db.batch([
        db
          .prepare("UPDATE reclamos SET foto_keys = json_insert(foto_keys, '$[#]', ?), updated_at = ? WHERE id = ? AND json_array_length(foto_keys) < 10")
          .bind(key, now, ticketId),
        db
          .prepare("INSERT INTO reclamos_eventos (id, reclamo_id, tipo, detalle, autor, created_at) VALUES (?, ?, 'foto', 'Foto del cliente', 'bot', ?)")
          .bind(crypto.randomUUID(), ticketId, now),
      ]);
    },

    async setTakeover(conversationId) {
      await db.prepare("UPDATE wa_conversations SET human_takeover = 1 WHERE id = ?").bind(conversationId).run();
    },

    async setMarketingOptIn(phone, optIn) {
      const tail = phoneTail(phone);
      if (tail.length !== 10) return 0;
      // El número del remitente lo verifica Meta: la baja (BAJA, STOP, "no quiero recibir más") marca la baja de marketing de las fichas con ese
      // teléfono exacto (sin promociones ni encuestas), y el ALTA, que es consentimiento explícito, la levanta (migración 0021).
      const r = await db
        .prepare(
          `UPDATE clients SET wa_marketing_opt_in = ?,
             unsubscribed_at = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(unsubscribed_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) END
           WHERE phone_digits = ?`,
        )
        .bind(optIn ? 1 : 0, optIn ? 1 : 0, tail)
        .run();
      return r.meta.changes;
    },

    async saveOutbound(conversationId, wamid, body) {
      await db
        .prepare("INSERT INTO wa_messages (id, conversation_id, wamid, direction, type, body, status) VALUES (?, ?, ?, 'out', 'text', ?, 'sent') ON CONFLICT (wamid) DO NOTHING")
        .bind(crypto.randomUUID(), conversationId, wamid, body)
        .run();
    },

    async saveTranscript(wamid, text) {
      await db.prepare("UPDATE wa_messages SET body = ? WHERE wamid = ? AND body IS NULL").bind(text, wamid).run();
    },
  };
}

type KbRow = { categoria: KnowledgeEntry["category"]; tema: string; contenido: string };
const toKnowledge = (r: KbRow): KnowledgeEntry => ({ category: r.categoria, topic: r.tema, content: r.contenido });

/** Todo menos el vocabulario (ese va al prompt, no a la búsqueda) y solo lo activo. */
const SEARCHABLE = "k.activo = 1 AND k.categoria <> 'vocabulario'";

/**
 * Entradas de kb_negocio relevantes para `query`: FTS5 (migración 0022) ordenado por bm25, con más peso en el tema
 * y en las palabras clave que en el contenido. Sin términos útiles: unas pocas entradas generales. Si FTS falla
 * (migración sin aplicar, consulta rechazada) se avisa en el log y se busca con LIKE sobre tema y contenido.
 */
async function searchKnowledgeD1(db: SqlDatabase, query: string, limit: number, log: Log): Promise<KnowledgeEntry[]> {
  const cap = Math.max(1, Math.min(20, Math.trunc(limit) || SEARCH_LIMIT));
  const match = buildFtsQuery(query);
  if (!match) {
    const { results } = await db
      .prepare(`SELECT k.categoria, k.tema, k.contenido FROM kb_negocio k WHERE ${SEARCHABLE} ORDER BY k.orden, k.tema LIMIT ?`)
      .bind(Math.min(cap, NO_QUERY_LIMIT))
      .all<KbRow>();
    return results.map(toKnowledge);
  }
  try {
    // Pesos de bm25 por columna (id, tema, contenido, palabras_clave): el tema y las palabras clave pesan más.
    const { results } = await db
      .prepare(
        `SELECT k.categoria, k.tema, k.contenido FROM kb_negocio_fts JOIN kb_negocio k ON k.id = kb_negocio_fts.id
         WHERE kb_negocio_fts MATCH ? AND ${SEARCHABLE}
         ORDER BY bm25(kb_negocio_fts, 0.0, 10.0, 1.0, 8.0), k.orden, k.tema LIMIT ?`,
      )
      .bind(match, cap)
      .all<KbRow>();
    return results.map(toKnowledge);
  } catch (err: unknown) {
    log("[whatsapp-bot] la búsqueda FTS del conocimiento falló, se usa LIKE", { error: err instanceof Error ? err.message : "error" });
  }
  const patterns = likePatterns(query);
  // En el SQL el carácter de escape es una sola barra invertida (escapeLike); en el código va duplicada.
  const where = patterns.map(() => "(k.tema LIKE ? ESCAPE '\\' OR k.contenido LIKE ? ESCAPE '\\')").join(" OR ");
  const { results } = await db
    .prepare(`SELECT k.categoria, k.tema, k.contenido FROM kb_negocio k WHERE ${SEARCHABLE} AND (${where}) ORDER BY k.orden, k.tema LIMIT ?`)
    .bind(...patterns.flatMap((p) => [p, p]), cap)
    .all<KbRow>();
  return results.map(toKnowledge);
}

/** Reclamo abierto (abierto o en curso) de la conversación; null si no hay. */
async function openComplaintD1(db: SqlDatabase, conversationId: string): Promise<ComplaintTicket | null> {
  const row = await db
    .prepare(
      `SELECT id, numero, categoria, order_id, json_array_length(foto_keys) AS fotos, created_at FROM reclamos
       WHERE conversation_id = ? AND estado <> 'resuelto' ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(conversationId)
    .first<{ id: string; numero: number; categoria: ComplaintCategory; order_id: string | null; fotos: number; created_at: string }>();
  return row
    ? { id: row.id, numero: Number(row.numero), created: false, categoria: row.categoria, orderId: row.order_id, fotos: Number(row.fotos), createdAt: new Date(row.created_at) }
    : null;
}
