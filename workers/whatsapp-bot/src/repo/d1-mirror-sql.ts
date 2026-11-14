import type postgres from "postgres";
import { phoneTail } from "./phone-tail.ts";
import type { MirrorReader } from "./d1-mirror.ts";

type Row = Record<string, unknown>;

/** Relee en Supabase (solo lectura, parametrizado) las filas que el bot acaba de escribir, para copiarlas a D1. */
export function sqlMirrorReader(sql: postgres.Sql): MirrorReader {
  return {
    async conversationsById(ids) {
      if (ids.length === 0) return [];
      return (await sql`select * from public.wa_conversations where id = any(${ids})`) as unknown as Row[];
    },
    async conversationsSharingTail(conversationId) {
      return (await sql`
        select * from public.wa_conversations
        where right(client_phone, 10) = (select right(client_phone, 10) from public.wa_conversations where id = ${conversationId})`) as unknown as Row[];
    },
    async messagesByWamid(wamid) {
      return (await sql`select * from public.wa_messages where wamid = ${wamid}`) as unknown as Row[];
    },
    async clientsByPhoneTail(phone) {
      return (await sql`
        select * from public.clients
        where phone is not null and right(regexp_replace(phone, '\\D', '', 'g'), 10) = ${phoneTail(phone)}`) as unknown as Row[];
    },
  };
}
