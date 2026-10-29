/**
 * Búsqueda única de conversaciones por teléfono: los últimos 10 dígitos (Argentina mezcla `549...` y `54...`).
 * La usan entrantes (`upsertConversation`), `getConversation` y el eco (`ensureConversation` / `pauseBot`),
 * para que una pausa nunca quede sin efecto por una diferencia de prefijo.
 */
const TAIL_DIGITS = 10;

/** Últimos 10 dígitos del teléfono (el valor que se compara contra `right(client_phone, 10)`). */
export function phoneTail(phone: string): string {
  return phone.replace(/\D/g, "").slice(-TAIL_DIGITS);
}

export interface MatchedConversation {
  /** Pausa vigente o human_takeover. */
  silenced: boolean;
}

export interface ConversationMatch<T extends MatchedConversation> {
  /** La de actividad más reciente (las filas llegan ordenadas así desde SQL). */
  primary: T;
  /** Fail-closed: si CUALQUIER conversación con esos 10 dígitos está silenciada, el bot calla. */
  silenced: boolean;
  /** Cuántas filas más comparten los 10 dígitos (0 = sin ambigüedad). */
  duplicates: number;
}

/** Resuelve las filas que coinciden (ya ordenadas por actividad reciente, la más nueva primero). */
export function resolveMatches<T extends MatchedConversation>(rows: readonly T[]): ConversationMatch<T> | null {
  const [primary] = rows;
  if (!primary) return null;
  return { primary, silenced: rows.some((row) => row.silenced), duplicates: rows.length - 1 };
}
