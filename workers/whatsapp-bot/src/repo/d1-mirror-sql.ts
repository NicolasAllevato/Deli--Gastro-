import { phoneTail } from "./phone-tail.ts";
import type { MirrorReader } from "./d1-mirror.ts";

type Row = Record<string, unknown>;

/**
 * Lo único que se usa de `postgres`: el template etiquetado (parametriza cada valor).
 * Sin importar el paquete, así el typecheck de la raíz y los tests no lo necesitan.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- el tag de postgres acepta cualquier valor parametrizable.
type SqlTag = (strings: TemplateStringsArray, ...values: any[]) => unknown;

/** Tope de filas por relectura por teléfono: es una copia, no un barrido (nota del auditor). */
const TAIL_LIMIT = 5;
const TAIL_DIGITS = 10;

/** Relee en Supabase (solo lectura, parametrizado) las filas que el bot acaba de escribir, para copiarlas a D1. */
export function sqlMirrorReader(sql: SqlTag): MirrorReader {
  return {
    async conversationsById(ids) {
      if (ids.length === 0) return [];
      return (await sql`select * from public.wa_conversations where id = any(${ids})`) as unknown as Row[];
    },
    async conversationsSharingTail(conversationId) {
      return (await sql`
        select * from public.wa_conversations
        where length((select right(client_phone, 10) from public.wa_conversations where id = ${conversationId})) = ${TAIL_DIGITS}
          and right(client_phone, 10) = (select right(client_phone, 10) from public.wa_conversations where id = ${conversationId})
        limit ${TAIL_LIMIT}`) as unknown as Row[];
    },
    async messagesByWamid(wamid) {
      return (await sql`select * from public.wa_messages where wamid = ${wamid} limit 1`) as unknown as Row[];
    },
    async clientsByPhoneTail(phone) {
      const tail = phoneTail(phone);
      // Un teléfono vacío o corto no identifica a nadie: no se copia nada.
      if (tail.length !== TAIL_DIGITS) return [];
      return (await sql`
        select * from public.clients
        where phone is not null and right(regexp_replace(phone, '\\D', '', 'g'), 10) = ${tail}
        limit ${TAIL_LIMIT}`) as unknown as Row[];
    },
  };
}
