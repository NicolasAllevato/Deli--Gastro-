/**
 * Menú para el modelo: compacto (sin descripciones largas) y agrupado por categoría, para que el menú
 * completo entre entero en el resultado de la herramienta. Antes iba como JSON con descripción por producto
 * y el corte a 6000 caracteres dejaba solo la primera categoría (Bebidas): el bot decía que no había pizzas.
 * Todo puro: lo usan las herramientas y los tests.
 */
import type { MenuItem } from "../repo/types.ts";
import { money } from "../orders/flow.ts";

/** Tope del resultado de get_menu: entra un menú de ~150 productos con margen. */
export const MENU_RESULT_CHARS = 20_000;
const SHORT_DESC = 60;

export const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export interface CompactItem {
  id?: string;
  name: string;
  price_text: string;
  desc?: string;
}

export interface CompactCategory {
  categoria: string;
  emoji: string;
  productos: CompactItem[];
}

const EMOJIS: readonly [RegExp, string][] = [
  [/pizza|muzza/, "🍕"],
  [/empanada/, "🥟"],
  [/bebida|gaseosa|cerveza|vino|trago/, "🥤"],
  [/postre|helado|dulce/, "🍰"],
  [/promo|combo/, "🔥"],
  [/cafe|cafeteria|desayuno|merienda/, "☕"],
  [/hamburguesa|burger/, "🍔"],
  [/ensalada/, "🥗"],
  [/pasta|ravioles|sorrentinos|noquis/, "🍝"],
  [/plato|principal|minuta|milanesa/, "🍽️"],
  [/entrada|picada|tabla/, "🧀"],
];

export function categoryEmoji(category: string): string {
  const f = fold(category);
  return EMOJIS.find(([re]) => re.test(f))?.[1] ?? "🍴";
}

function compactItem(p: MenuItem, withIds: boolean, withDesc: boolean): CompactItem {
  const item: CompactItem = { name: p.name.trim(), price_text: money(p.price) };
  const desc = withDesc ? (p.description ?? "").replace(/\s+/g, " ").trim() : "";
  if (desc) item.desc = desc.length > SHORT_DESC ? `${desc.slice(0, SHORT_DESC - 1)}…` : desc;
  return withIds ? { id: p.id, ...item } : item;
}

/** Agrupa por categoría respetando el orden del catálogo (ya viene ordenado por categoría y nombre). */
export function groupMenu(menu: readonly MenuItem[], withIds: boolean, withDesc = false): CompactCategory[] {
  const groups = new Map<string, CompactCategory>();
  for (const p of menu) {
    const key = p.category?.trim() || "Otros";
    const group = groups.get(key) ?? { categoria: key, emoji: categoryEmoji(key), productos: [] };
    groups.set(key, { ...group, productos: [...group.productos, compactItem(p, withIds, withDesc)] });
  }
  return [...groups.values()];
}

/** Resultado de get_menu: todas las categorías con todos sus productos (id solo con pedidos encendidos). */
export function menuForModel(menu: readonly MenuItem[], withIds: boolean): { categorias: CompactCategory[]; total_productos: number } {
  return { categorias: groupMenu(menu, withIds), total_productos: menu.length };
}

/**
 * Sinónimos de lo que pide el cliente → palabras que buscan en el nombre o la categoría del producto.
 * No hay categoría "Pizzas": las pizzas viven en "Platos Principales" y "Promos", por eso se busca por nombre.
 */
const SYNONYMS: readonly [RegExp, RegExp][] = [
  [/^pizz?as?$|^pizzeria$/, /pizz|muzz|muza|fugaz|napolitan|calabres|4 quesos|cuatro quesos|jamon y morron|especial|margarit|rucula|provolone|roquefort|anana|palmito|faina/],
  [/^empanadas?$/, /empanada/],
  [/^bebidas?$|^gaseosas?$|^tomar$/, /bebida|gaseosa|coca|sprite|fanta|agua|cerveza|vino|jugo|pepsi|7 ?up|soda/],
  [/^postres?$|^dulces?$/, /postre|helado|flan|tiramisu|brownie|torta|dulce de leche|budin|chocotorta/],
  [/^promos?$|^promociones?$|^combos?$|^ofertas?$/, /promo|combo/],
  [/^cafe(teria)?$|^desayunos?$|^meriendas?$/, /cafe|cafeteria|medialuna|desayuno|merienda|cortado|capuccino|te\b/],
  [/^faina$/, /faina/],
];

const STOP = /^(las?|los?|el|de|del|unas?|unos?|que|hay|tenes|tienen|mostrame|pasame|categoria)$/;

/** Normaliza la consulta: sin tildes, sin artículos ("las pizzas" → "pizzas"). */
function queryWords(query: string): string {
  return fold(query).replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.test(w)).join(" ");
}

/**
 * Todos los productos de una categoría o familia ("pizzas", "empanadas", "bebidas", "postres", "promos",
 * "cafetería"), tolerante a tildes, mayúsculas, plural y sinónimos. Primero coincide la categoría por nombre;
 * si no, por sinónimos en nombre o categoría; si no, por la palabra en el nombre del producto.
 */
export function productsForCategory(menu: readonly MenuItem[], query: string): MenuItem[] {
  const q = queryWords(query);
  if (!q) return [];
  const singular = q.replace(/(es|s)$/, "");
  const byCategory = menu.filter((p) => {
    const c = fold(p.category ?? "");
    return c === q || c.replace(/(es|s)$/, "") === singular;
  });
  if (byCategory.length > 0) return byCategory;
  const synonym = SYNONYMS.find(([re]) => re.test(q))?.[1];
  if (synonym) {
    const hits = menu.filter((p) => synonym.test(fold(p.name)) || synonym.test(fold(p.category ?? "")));
    if (hits.length > 0) return hits;
  }
  return menu.filter((p) => fold(p.name).includes(singular) || fold(p.category ?? "").includes(singular));
}

/** Resultado de get_categoria: TODOS los productos que coinciden, con precio; con descripción corta. */
export function categoryForModel(menu: readonly MenuItem[], query: string, withIds: boolean): Record<string, unknown> {
  const items = productsForCategory(menu, query);
  if (items.length === 0) {
    return {
      encontrado: false,
      consulta: query.slice(0, 60),
      categorias_disponibles: groupMenu(menu, false).map((c) => c.categoria),
      nota: "No hay productos con ese nombre. Ofrecé las categorías disponibles; no digas que no existe sin revisar get_menu.",
    };
  }
  return { encontrado: true, consulta: query.slice(0, 60), cantidad: items.length, categorias: groupMenu(items, withIds, true) };
}

/** El cliente pide la carta completa (no una categoría puntual): se le manda el PDF y la lista de categorías. */
export function asksFullMenu(text: string): boolean {
  const t = fold(text);
  if (/pizz|empanad|bebida|postre|promo|cafe/.test(t)) return false;
  if (/\b(carta|menu)\b/.test(t)) return true;
  return /\bque (tenes|tienen|hay|venden|ofrecen)\b\s*(para comer|hoy)?\s*\??$/.test(t);
}
