/** Valor de un campo "puntos por $100": vacío o inválido = `null` (hereda / no da puntos). */
export function parsePoints(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
