/**
 * Montos en centavos enteros (decisión D6). Única conversión pesos↔centavos.
 * Los pesos de Supabase (numeric) se convierten al migrar con toCents.
 */
export function toCents(pesos: number | string): number {
  const n = typeof pesos === "string" ? Number(pesos) : pesos;
  if (!Number.isFinite(n)) throw new Error("Monto inválido");
  // toFixed evita 1.005*100 = 100.49999…
  const cents = Math.round(Number((n * 100).toFixed(4)));
  return Object.is(cents, -0) ? 0 : cents;
}

export function fromCents(cents: number): number {
  if (!Number.isSafeInteger(cents)) throw new Error("Centavos inválidos");
  return cents / 100;
}

export function assertCents(value: unknown, field = "monto"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field}: se esperan centavos enteros >= 0`);
  }
  return value;
}
