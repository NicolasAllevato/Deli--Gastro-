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
import type { BotRepo, HistoryItem, InboundRepo, KnowledgeEntry } from "./types.ts";

type Log = (message: string, detail?: unknown) => void;
type ConvRow = { id: string; client_phone: string; silenced: number };

const MENU_LIMIT = 200;
const KNOWLEDGE_LIMIT = 80;
const now = () => new Date().toISOString();

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
      return results.map((r) => ({ id: r.id, name: r.name, description: r.description, price: fromCents(r.price_cents), category: r.category ?? "Otros" }));
    },

    async zones() {
      const { results } = await db
        .prepare("SELECT name, fee_cents, min_order_cents FROM delivery_zones WHERE is_active = 1 ORDER BY sort_order")
        .all<{ name: string; fee_cents: number; min_order_cents: number }>();
      return results.map((r) => ({ name: r.name, fee: fromCents(r.fee_cents), minOrder: fromCents(r.min_order_cents) }));
    },

    async knowledge() {
      const { results } = await db
        .prepare("SELECT categoria, tema, contenido FROM kb_negocio WHERE activo = 1 ORDER BY categoria, orden, tema LIMIT ?")
        .bind(KNOWLEDGE_LIMIT)
        .all<{ categoria: KnowledgeEntry["category"]; tema: string; contenido: string }>();
      return results.map((r) => ({ category: r.categoria, topic: r.tema, content: r.contenido }));
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

    async setTakeover(conversationId) {
      await db.prepare("UPDATE wa_conversations SET human_takeover = 1 WHERE id = ?").bind(conversationId).run();
    },

    async setMarketingOptIn(phone, optIn) {
      const tail = phoneTail(phone);
      if (tail.length !== 10) return 0;
      const r = await db.prepare("UPDATE clients SET wa_marketing_opt_in = ? WHERE phone_digits = ?").bind(optIn ? 1 : 0, tail).run();
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
