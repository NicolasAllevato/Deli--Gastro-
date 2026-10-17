const MIN_DIGITS = 8;
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
