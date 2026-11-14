/**
 * Reglas de combos y promos (compartidas por el sync de Fudo y los informes). Sin I/O.
 *
 * - Es COMBO un producto cuyo NOMBRE o CATEGORÍA (Fudo o app) contiene "combo" o "promo" (sin tildes ni
 *   mayúsculas) y se vendió a precio unitario > $0 ("La Rabona" en Promos, "COMBO PIZZAS X 2", "PROMO GAMBETA APPS").
 * - Es COMPONENTE lo que tiene "combo"/"promo" pero se vendió a $0 ("EMPANADA CARNE PROMO LIBRE",
 *   "Michelob Promo ($0)"): va a Productos con $0 y su nombre se limpia para sumarse al producto real.
 * - "(Adicional Promo)" es un producto normal: ni combo ni componente.
 */

export const normalizeText = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** "Jugo De Naranja (Adicional Promo)": producto normal. */
export function isAdditionalPromo(name: string): boolean {
  return /adicional\s+promo/.test(normalizeText(name));
}

/** Nombre o categoría con "combo" o "promo" (sin contar "Adicional Promo"). */
export function hasComboWord(text: string | null | undefined): boolean {
  if (!text) return false;
  const n = normalizeText(text).replace(/adicional\s+promo/g, "");
  return n.includes("combo") || n.includes("promo");
}

/** Combo: (nombre o categoría con combo/promo) y precio > 0. "(Adicional Promo)" nunca. */
export function isComboProduct(name: string, category: string | null | undefined, unitPrice: number): boolean {
  if (isAdditionalPromo(name) || !(unitPrice > 0)) return false;
  return hasComboWord(name) || hasComboWord(category);
}

/** Componente de promo: nombre o categoría con combo/promo, vendido a $0. */
export function isPromoComponent(name: string, category: string | null | undefined, unitPrice: number): boolean {
  if (isAdditionalPromo(name) || unitPrice !== 0) return false;
  return hasComboWord(name) || hasComboWord(category);
}

/**
 * Quita las marcas de promo del nombre: "EMPANADA CARNE PROMO LIBRE" → "EMPANADA CARNE";
 * "Michelob Promo ($0)" → "Michelob"; "FAINA X PROMO PIZZA LIBRE" → "FAINA X".
 */
export function stripPromoMarks(name: string): string {
  const out = name
    .replace(/\(\s*\$\s*0\s*\)/g, " ")
    .replace(/\bpromo(?:\s+pizza)?(?:\s+libre)?\b/gi, " ")
    .replace(/\bcombo\b/gi, " ")
    .replace(/[\s\-–·,;:]+$/g, "")
    .replace(/^[\s\-–·,;:]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return out || name.trim();
}
