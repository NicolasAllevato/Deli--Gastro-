import type postgres from "postgres";
import { TAKEOVER_KEY, takeoverMinutesFromConfig } from "../bot/settings.ts";
import { phoneTail, resolveMatches } from "./phone-tail.ts";
import type { InboundRepo } from "./types.ts";

export type * from "./types.ts";

/** Cliente con el mismo teléfono (últimos 10 dígitos, como `samePhone`). */
const CLIENT_BY_PHONE = (sql: postgres.Sql, phone: string) => sql`
  (select id from public.clients
   where phone is not null
     and right(regexp_replace(phone, '\\D', '', 'g'), 10) = right(${phone}, 10)
   order by created_at
   limit 1)`;

type Row = { id: string; client_phone: string; silenced: boolean };
type Log = (message: string, detail?: unknown) => void;

const stored = (row: Row, silenced: boolean) => ({ id: row.id, phone: row.client_phone, humanTakeover: silenced });

export function sqlInboundRepo(sql: postgres.Sql, log: Log = () => {}): InboundRepo {
  /** Conversaciones con los mismos 10 dígitos, la de actividad más reciente primero. */
  const matching = (phone: string) => sql<Row[]>`
    select id, client_phone, (human_takeover or coalesce(bot_paused_until > now(), false)) as silenced
    from public.wa_conversations
    where right(client_phone, 10) = ${phoneTail(phone)}
    order by coalesce(last_inbound_at, created_at) desc, created_at desc`;

  const warnDuplicates = (count: number) => {
    if (count > 0) log("[whatsapp-bot] varias conversaciones comparten el teléfono (últimos 10 dígitos)", { duplicates: count });
  };

  return {
    async upsertConversation(phone, name) {
      const found = resolveMatches(await matching(phone));
      if (found) {
        warnDuplicates(found.duplicates);
        await sql`
          update public.wa_conversations set
            contact_name = coalesce(contact_name, ${name}),
            client_id = coalesce(client_id, ${CLIENT_BY_PHONE(sql, phone)}),
            last_inbound_at = now()
          where id = ${found.primary.id}`;
        return stored(found.primary, found.silenced);
      }
      // Atómico: dos mensajes simultáneos del mismo teléfono no crean dos conversaciones.
      const [row] = await sql<Row[]>`
        insert into public.wa_conversations (client_phone, contact_name, client_id, last_inbound_at)
        values (${phone}, ${name}, ${CLIENT_BY_PHONE(sql, phone)}, now())
        on conflict (client_phone) do update set
          contact_name = coalesce(public.wa_conversations.contact_name, excluded.contact_name),
          client_id = coalesce(public.wa_conversations.client_id, excluded.client_id),
          last_inbound_at = now()
        returning id, client_phone, (human_takeover or coalesce(bot_paused_until > now(), false)) as silenced`;
      return stored(row, row.silenced);
    },

    async hasOutbound(wamid) {
      const rows = await sql`select 1 from public.wa_messages where wamid = ${wamid} and direction = 'out' limit 1`;
      return rows.length > 0;
    },

    async ensureConversation(phone) {
      let found = resolveMatches(await matching(phone));
      if (!found) {
        await sql`
          insert into public.wa_conversations (client_phone, client_id)
          values (${phone}, ${CLIENT_BY_PHONE(sql, phone)})
          on conflict (client_phone) do nothing`;
        found = resolveMatches(await matching(phone));
      }
      if (!found) throw new Error("no se pudo crear la conversación del eco");
      warnDuplicates(found.duplicates);
      return stored(found.primary, found.silenced);
    },

    async pauseBot(conversationId, until) {
      // Fail-closed: pausa TODAS las conversaciones con los mismos 10 dígitos que la elegida.
      const rows = await sql`
        update public.wa_conversations set bot_paused_until = greatest(bot_paused_until, ${until})
        where right(client_phone, 10) = (select right(client_phone, 10) from public.wa_conversations where id = ${conversationId})
        returning id`;
      return rows.length;
    },

    async saveEcho(conversationId, message) {
      const rows = await sql`
        insert into public.wa_messages (conversation_id, wamid, direction, type, body, status)
        values (${conversationId}, ${message.wamid}, 'out', ${message.type}, ${message.body}, 'sent')
        on conflict (wamid) do nothing
        returning id`;
      return rows.length > 0;
    },

    async takeoverMinutes() {
      const [row] = await sql<{ value: unknown }[]>`select value from public.global_config where key = ${TAKEOVER_KEY}`;
      return takeoverMinutesFromConfig({ [TAKEOVER_KEY]: row?.value });
    },

    async saveInbound(conversationId, message) {
      const rows = await sql`
        insert into public.wa_messages (conversation_id, wamid, direction, type, body)
        values (${conversationId}, ${message.wamid}, 'in', ${message.type}, ${message.body})
        on conflict (wamid) do nothing
        returning id`;
      return rows.length > 0;
    },

    async updateStatus(wamid, status) {
      await sql`update public.wa_messages set status = ${status} where wamid = ${wamid}`;
    },
  };
}
