import type postgres from "postgres";
import type { InboundRepo } from "./types.ts";

export type * from "./types.ts";

/** Cliente con el mismo teléfono (últimos 10 dígitos, como `samePhone`). */
const CLIENT_BY_PHONE = (sql: postgres.Sql, phone: string) => sql`
  (select id from public.clients
   where phone is not null
     and right(regexp_replace(phone, '\\D', '', 'g'), 10) = right(${phone}, 10)
   order by created_at
   limit 1)`;

export function sqlInboundRepo(sql: postgres.Sql): InboundRepo {
  return {
    async upsertConversation(phone, name) {
      // Atómico: dos mensajes simultáneos del mismo teléfono no crean dos conversaciones.
      const [row] = await sql<{ id: string; client_phone: string; human_takeover: boolean }[]>`
        insert into public.wa_conversations (client_phone, contact_name, client_id, last_inbound_at)
        values (${phone}, ${name}, ${CLIENT_BY_PHONE(sql, phone)}, now())
        on conflict (client_phone) do update set
          contact_name = coalesce(public.wa_conversations.contact_name, excluded.contact_name),
          client_id = coalesce(public.wa_conversations.client_id, excluded.client_id),
          last_inbound_at = now()
        returning id, client_phone, human_takeover`;
      return { id: row.id, phone: row.client_phone, humanTakeover: row.human_takeover };
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
