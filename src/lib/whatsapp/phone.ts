export const MIN_DIGITS = 8;
const COMPARE_DIGITS = 10;

/** Solo dígitos: "+54 9 11 5555-0101" → "5491155550101". */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Dos teléfonos son el mismo si coinciden en los últimos 10 dígitos. Evita
 * depender del prefijo de país (+54, 549, 0, 15) que cambia entre fuentes.
 */
export function samePhone(a: string, b: string): boolean {
  const left = normalizePhone(a);
  const right = normalizePhone(b);
  if (left.length < MIN_DIGITS || right.length < MIN_DIGITS) return false;
  return left.slice(-COMPARE_DIGITS) === right.slice(-COMPARE_DIGITS);
}

/**
 * Número para WhatsApp en Argentina: solo dígitos, con 549 adelante.
 * "11 5619-4690" → "5491156194690"; "011 ..." y "+54 11 ..." también (a los celulares les falta el 9).
 * Un número que no es de 10 dígitos locales ni empieza con 54 se deja como está (puede ser de otro país).
 */
export function toArgentineWhatsApp(phone: string): string {
  let d = normalizePhone(phone);
  if (d.startsWith("549")) return d;
  if (d.startsWith("54") && d.length === 12) return `549${d.slice(2)}`;
  if (d.startsWith("0")) d = d.slice(1);
  return d.length === 10 ? `549${d}` : d;
}
