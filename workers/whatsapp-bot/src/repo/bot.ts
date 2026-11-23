import type postgres from "postgres";
import { phoneTail, resolveMatches } from "./phone-tail.ts";
import type { BotRepo, HistoryItem } from "./types.ts";

export type * from "./types.ts";

const MENU_LIMIT = 200;

export function sqlBotRepo(sql: postgres.Sql, log: (message: string, detail?: unknown) => void = () => {}): BotRepo {
  return {
    async getConversation(phone) {
      // Mismos 10 dígitos que entrantes y eco; con varias filas manda la de actividad más reciente y, si alguna
      // está silenciada, el bot calla (fail-closed).
      const rows = await sql<{ id: string; client_phone: string; client_id: string | null; name: string | null; silenced: boolean }[]>`
        select c.id, c.client_phone, c.client_id, coalesce(cl.name, c.contact_name) as name,
          (c.human_takeover or coalesce(c.bot_paused_until > now(), false)) as silenced
        from public.wa_conversations c
        left join public.clients cl on cl.id = c.client_id
        where right(c.client_phone, 10) = ${phoneTail(phone)}
        order by coalesce(c.last_inbound_at, c.created_at) desc, c.created_at desc`;
      const found = resolveMatches(rows);
      if (!found) return null;
      if (found.duplicates > 0) log("[whatsapp-bot] varias conversaciones comparten el teléfono (últimos 10 dígitos)", { duplicates: found.duplicates });
      const { primary } = found;
      return { id: primary.id, phone: primary.client_phone, clientId: primary.client_id, displayName: primary.name, humanTakeover: found.silenced };
    },

    async history(conversationId, limit, since) {
      const rows = await sql<HistoryItem[]>`
        select direction, body from public.wa_messages
        where conversation_id = ${conversationId} and body is not null and (${since ?? null}::timestamptz is null or created_at >= ${since ?? null}::timestamptz)
        order by created_at desc limit ${limit}`;
      return rows.reverse();
    },

    async inboundCounts(conversationId) {
      const [row] = await sql<{ last_minute: number; last_day: number }[]>`
        select
          count(*) filter (where created_at > now() - interval '1 minute')::int as last_minute,
          count(*)::int as last_day
        from public.wa_messages
        where conversation_id = ${conversationId} and direction = 'in' and created_at > now() - interval '1 day'`;
      return { lastMinute: row?.last_minute ?? 0, lastDay: row?.last_day ?? 0 };
    },

    async config() {
      const rows = await sql<{ key: string; value: unknown }[]>`select key, value from public.global_config`;
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    },

    async menu() {
      const rows = await sql<{ id: string; name: string; description: string | null; price: string; category: string | null }[]>`
        select p.id, p.name, p.description, p.price, c.name as category
        from public.products p left join public.categories c on c.id = p.category_id
        where p.is_active order by c.name nulls last, p.name limit ${MENU_LIMIT}`;
      return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, price: Number(r.price), category: r.category ?? "Otros" }));
    },

    async zones() {
      const rows = await sql<{ name: string; fee: string; min_order: string }[]>`
        select name, fee, min_order from public.delivery_zones where is_active order by sort_order`;
      return rows.map((r) => ({ name: r.name, fee: Number(r.fee), minOrder: Number(r.min_order) }));
    },

    async latestOrder(clientId) {
      const [row] = await sql<{ id: string; status: string; items_desc: string; total: string; courier_name: string | null; created_at: Date }[]>`
        select id, status, items_desc, total, courier_name, created_at from public.orders
        where client_id = ${clientId} order by created_at desc limit 1`;
      return row
        ? { id: row.id, status: row.status, itemsDesc: row.items_desc, total: Number(row.total), courierName: row.courier_name, createdAt: row.created_at }
        : null;
    },

    async setTakeover(conversationId) {
      await sql`update public.wa_conversations set human_takeover = true where id = ${conversationId}`;
    },

    async setMarketingOptIn(phone, optIn) {
      const rows = await sql`
        update public.clients set wa_marketing_opt_in = ${optIn}
        where phone is not null and right(regexp_replace(phone, '\\D', '', 'g'), 10) = right(${phone}, 10)
        returning id`;
      return rows.length;
    },

    async saveOutbound(conversationId, wamid, body) {
      await sql`
        insert into public.wa_messages (conversation_id, wamid, direction, type, body, status)
        values (${conversationId}, ${wamid}, 'out', 'text', ${body}, 'sent')
        on conflict (wamid) do nothing`;
    },

    async saveTranscript(wamid, text) {
      await sql`update public.wa_messages set body = ${text} where wamid = ${wamid} and body is null`;
    },
  };
}
