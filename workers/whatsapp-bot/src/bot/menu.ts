/**
 * Menú para el modelo: compacto (sin descripciones largas) y agrupado por categoría, para que el menú
 * completo entre entero en el resultado de la herramienta. Antes iba como JSON con descripción por producto
 * y el corte a 6000 caracteres dejaba solo la primera categoría (Bebidas): el bot decía que no había pizzas.
 * Todo puro: lo usan las herramientas y los tests.
 */
import type { CartaSeccion, MenuItem, OptionGroup } from "../repo/types.ts";
import { cleanOptionName, money } from "../orders/flow.ts";

/** Tope del resultado de get_menu: entra un menú de ~150 productos con margen. */
export const MENU_RESULT_CHARS = 20_000;
const SHORT_DESC = 60;

/** ¿El texto del cliente nombra algún producto del menú (por una palabra significativa)? Distingue «2 cafés y 4 medialunas» de «quiero pedir». */
export function namesProducts(text: string, menu: readonly MenuItem[]): boolean {
  const words = fold(text).replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).map((w) => w.replace(/(es|s)$/, "")).filter((w) => w.length >= 4);
  if (words.length === 0) return false;
  const names = menu.map((p) => fold(p.name));
  return words.some((w) => names.some((n) => n.includes(w)));
}

export const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export interface CompactItem {
  id?: string;
  name: string;
  price_text: string;
  desc?: string;
  /** Ids de grupos de opciones a elegir (ver `grupos_de_opciones` de get_menu). Solo con pedidos encendidos. */
  grupos?: number[];
}

export interface CompactCategory {
  categoria: string;
  emoji: string;
  productos: CompactItem[];
}

const EMOJIS: readonly [RegExp, string][] = [
  [/pizza|muzza|faina/, "🍕"],
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
  return withIds ? { id: p.id, ...item, ...(p.groups?.length ? { grupos: p.groups } : {}) } : item;
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

export interface OptionGroupForModel {
  nombre: string;
  min: number | null;
  max: number | null;
  /** Cuántas opciones debe elegir el cliente, en palabras para el modelo (vacío si el grupo no fija cantidad). */
  elegir?: string;
  opciones: { id: number; nombre: string }[];
}

/**
 * Diccionario compacto `grupos_de_opciones` para get_menu: solo los grupos que algún producto del menú usa y que tienen opciones.
 * Vacío = no se agrega nada al resultado.
 */
/** «Elegí exactamente 2» / «Elegí entre 1 y 3» a partir del min/max del grupo (la descripción del producto puede decir otra cosa). */
export function chooseText(g: Pick<OptionGroup, "min" | "max">): { elegir: string } | Record<string, never> {
  const { min, max } = g;
  if (min !== null && max !== null && min === max && min > 0) return { elegir: `Elegí exactamente ${min} (pedile al cliente ${min}, no menos)` };
  if (min !== null && min > 0) return { elegir: `Elegí al menos ${min}${max !== null ? ` y como mucho ${max}` : ""}` };
  return {};
}

export function optionGroupsForModel(menu: readonly MenuItem[], groups: Readonly<Record<string, OptionGroup>>): Record<string, OptionGroupForModel> {
  const used = new Set(menu.flatMap((p) => p.groups ?? []).map(String));
  const out: Record<string, OptionGroupForModel> = {};
  for (const [id, g] of Object.entries(groups)) {
    if (used.has(id) && g.options.length > 0) out[id] = { nombre: g.name, min: g.min, max: g.max, ...chooseText(g), opciones: g.options.map((o) => ({ id: o.id, nombre: cleanOptionName(o.name) })) };
  }
  return out;
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
  const direct = menu.filter((p) => fold(p.name).includes(singular) || fold(p.category ?? "").includes(singular));
  if (direct.length > 0) return direct;
  const zero = zeroAlcoholHits(menu, q);
  if (zero.length > 0) return zero;
  // «empanadas de humita» vs «Empanada Humita»: todas las palabras del pedido (sin el plural) tienen que aparecer; si no, solo las específicas.
  const tokens = queryTokens(q);
  const haystack = (p: MenuItem): string => fold(`${p.name} ${p.category ?? ""}`);
  const all = menu.filter((p) => tokens.every((t) => haystack(p).includes(t)));
  if (all.length > 0) return all;
  const specific = tokens.filter((t) => !FAMILY_WORD.test(t));
  return specific.length > 0 && specific.length < tokens.length ? menu.filter((p) => specific.every((t) => haystack(p).includes(t))) : [];
}

const FAMILY_WORD = /^(empanad|pizz|bebid|gaseos|postre|cafe|promo)/;

/** Palabras de la consulta sin el plural (≥ 3 letras): «empanadas humita» → [empanad, humita]. */
function queryTokens(q: string): string[] {
  return q.split(" ").map((w) => (w.length > 3 ? w.replace(/(es|s)$/, "") : w)).filter((w) => w.length >= 3);
}

/** Sin alcohol: «cerveza sin alcohol» → las cervezas Zero / 0,0; «bebidas sin alcohol» → toda bebida que no tenga alcohol. */
function zeroAlcoholHits(menu: readonly MenuItem[], q: string): MenuItem[] {
  const mode = alcoholFilter(q);
  if (mode !== "cerveza_sin" && mode !== "sin") return [];
  const drinks = menu.filter((p) => /bebida/.test(fold(p.category ?? "")) || BEER.test(fold(p.name)) || isZeroAlcohol(p.name));
  return mode === "cerveza_sin" ? drinks.filter((p) => BEER.test(fold(p.name)) && isZeroAlcohol(p.name)) : drinks.filter((p) => !isAlcoholic(p.name));
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

// --- carta estructurada (la carta impresa del local) -------------------------------------------------------

export interface CartaVariante {
  id: string;
  name: string;
  /** Nombre real del producto de ese id (una línea de la carta puede agrupar variantes: «Muzzarella» tiene columnas grande y porción). */
  producto?: string;
  price_text: string;
}

export interface CartaBloque {
  categoria: string;
  emoji: string;
  /** Bloque listo para copiar al cliente (una línea por producto, precios ya formateados). */
  texto: string;
  /** Variantes pedibles con su product_id (solo con pedidos encendidos). */
  productos?: CartaVariante[];
}

const precioTexto = (p: { price: number } | null): string => (p ? money(p.price) : "consultar");

/** Texto de una sección: "🍕 Pizzas (8 porciones / Porción)
• Muzzarella — $25.000 / $3.600". */
export function formatCartaSeccion(s: CartaSeccion): string {
  const emoji = categoryEmoji(s.titulo);
  if (s.estilo === "gustos") {
    const unico = s.items.flatMap((i) => i.productos).find((p) => p !== null) ?? null;
    // Un solo precio arriba y los gustos en lista, sin repetir el precio en cada uno.
    const gustos = s.items.map((i) => `• ${i.nombre}`);
    return [`${emoji} ${s.titulo} — ${unico ? `${money(unico.price)} c/u` : "consultar precio"}`, "Gustos:", ...gustos].join("\n");
  }
  const head = `${emoji} ${s.titulo}${s.columnas.length ? ` (${s.columnas.join(" / ")})` : ""}`;
  const lines = s.items.map((i) => {
    const cols = Math.max(1, s.columnas.length);
    const prices = Array.from({ length: cols }, (_, c) => precioTexto(i.productos[c] ?? null)).join(" / ");
    return `• ${i.nombre}${i.nota ? ` (${i.nota})` : ""} — ${prices}`;
  });
  return [head, ...lines].join("\n");
}

function variantes(s: CartaSeccion, names?: ReadonlyMap<string, string>): CartaVariante[] {
  return s.items.flatMap((i) =>
    i.productos.flatMap((p, c) => {
      if (!p) return [];
      const label = s.estilo === "gustos" ? `${s.titulo.replace(/s$/i, "")} de ${i.nombre}` : s.columnas.length > 1 ? `${i.nombre} (${s.columnas[c]})` : i.nombre;
      const producto = names?.get(p.id);
      return [{ id: p.id, name: label, ...(producto ? { producto } : {}), price_text: money(p.price) }];
    }),
  );
}

const namesById = (menu: readonly MenuItem[]): Map<string, string> => new Map(menu.map((p) => [p.id, p.name.trim()] as const));

function bloque(s: CartaSeccion, withIds: boolean, names?: ReadonlyMap<string, string>): CartaBloque {
  const b: CartaBloque = { categoria: s.titulo, emoji: categoryEmoji(s.titulo), texto: formatCartaSeccion(s) };
  return withIds ? { ...b, productos: variantes(s, names) } : b;
}

const linkedIds = (carta: readonly CartaSeccion[]): Set<string> =>
  new Set(carta.flatMap((s) => s.items.flatMap((i) => i.productos.flatMap((p) => (p ? [p.id] : [])))));

/** get_menu con carta: las secciones de la carta y, aparte, lo que no está en ella (promos, etc.) por categoría. */
export function cartaMenuForModel(carta: readonly CartaSeccion[], menu: readonly MenuItem[], withIds: boolean): Record<string, unknown> {
  const linked = linkedIds(carta);
  const resto = menu.filter((p) => !linked.has(p.id));
  return {
    carta: carta.map((s) => bloque(s, withIds, namesById(menu))),
    otras_categorias: groupMenu(resto, withIds),
    nota: "Para mostrar una sección copiá su 'texto' tal cual. Para cotizar usá el id de 'productos'; su campo 'producto' es el nombre real de ese id. " +
      "Si el cliente pide otra variante (grande en vez de porción, otro gusto, otro tamaño) y 'producto' no es esa, buscá el producto exacto en 'otras_categorias' o con get_categoria: no uses el id de otra variante.",
  };
}

/** Secciones de la carta para una consulta ("pizzas" → Pizzas + Pizzas especiales + Fainá). */
const CARTA_SYNONYMS: readonly [RegExp, RegExp][] = [
  [/^pizz?as?$|^pizzeria$|^muzzas?$/, /pizz|faina/],
  [/^empanadas?$/, /empanad/],
  [/^bebidas?$|^gaseosas?$|^tomar$|^cervezas?$/, /bebida/],
  [/^postres?$|^dulces?$/, /postre/],
  [/^cafe(teria)?$|^desayunos?$|^meriendas?$/, /desayuno|merienda|cafe/],
  [/^faina$/, /faina/],
];

export function cartaSectionsFor(carta: readonly CartaSeccion[], query: string): CartaSeccion[] {
  const q = queryWords(query);
  if (!q) return [];
  const syn = CARTA_SYNONYMS.find(([re]) => re.test(q))?.[1];
  if (syn) {
    const hits = carta.filter((s) => syn.test(fold(s.titulo)));
    if (hits.length > 0) return hits;
  }
  const singular = q.replace(/(es|s)$/, "");
  const byTitle = carta.filter((s) => fold(s.titulo).includes(singular));
  if (byTitle.length > 0) return byTitle;
  // «empanadas de humita»: la sección que tiene ese gusto, con solo esa línea (palabras específicas del pedido en el nombre de la línea).
  const specific = queryTokens(q).filter((t) => !FAMILY_WORD.test(t));
  if (specific.length === 0) return [];
  return carta
    .map((s) => ({ ...s, items: s.items.filter((i) => specific.every((t) => fold(i.nombre).includes(t))) }))
    .filter((s) => s.items.length > 0);
}

/** get_categoria con carta; null si la consulta no corresponde a ninguna sección (se usa la búsqueda de siempre). */
export function cartaCategoryForModel(carta: readonly CartaSeccion[], query: string, withIds: boolean, menu: readonly MenuItem[] = []): Record<string, unknown> | null {
  const filtro = alcoholFilter(query);
  const base = cartaSectionsFor(carta, filtro ? "bebidas" : query);
  const secciones = filtro ? base.map((s) => filterAlcohol(s, filtro)).filter((s) => s.items.length > 0) : base;
  if (secciones.length === 0) return null;
  return {
    encontrado: true,
    consulta: query.slice(0, 60),
    secciones: secciones.map((s) => bloque(s, withIds, namesById(menu))),
    nota: "Respondé copiando el 'texto' de cada sección tal cual (todas las líneas). No repitas el precio en cada gusto.",
  };
}

/** Bebidas con alcohol (por nombre): cervezas, vinos, aperitivos. */
const ALCOHOL = /cerveza|andes|stella|budweiser|quilmes|corona|michelob|patagonia|heineken|brahma|imperial|fernet|vino|malbec|cabernet|nicasia|lobo|gin\b|vodka|whisky|aperol|campari|sidra|champ|trago|ipa\b|lager|rubia|negra|roja/;
/** «Zero», «0,0» o «sin alcohol» en el nombre: la cerveza no tiene alcohol aunque la marca sea de cerveza. */
const ZERO = /\bzero\b|\b0[,. ]?0\b|sin alcohol/;
export const isZeroAlcohol = (name: string): boolean => ZERO.test(fold(name));
const BEER = /cerveza|andes|stella|budweiser|quilmes|corona|michelob|patagonia|heineken|brahma|imperial|ipa\b|lager|rubia|negra|roja/;
export const isAlcoholic = (name: string): boolean => ALCOHOL.test(fold(name)) && !isZeroAlcohol(name);

/**
 * "cerveza sin alcohol" → solo cervezas Zero/0,0; "sin alcohol"/"gaseosas" → solo sin alcohol; "cervezas"/"con alcohol"/"vinos" → solo
 * con alcohol; si no, null.
 */
export function alcoholFilter(query: string): "sin" | "con" | "cerveza_sin" | null {
  const q = fold(query);
  if (/cerveza|birra/.test(q) && /sin alcohol|no alcoh|zero|\b0[,. ]?0\b|cero/.test(q)) return "cerveza_sin";
  if (/sin alcohol|no alcoh|gaseosa|refresco|soda|para (los )?chicos/.test(q)) return "sin";
  if (/con alcohol|cerveza|birra|vino|trago|aperitivo|fernet/.test(q)) return "con";
  return null;
}

function filterAlcohol(s: CartaSeccion, filtro: "sin" | "con" | "cerveza_sin"): CartaSeccion {
  if (filtro === "cerveza_sin") return { ...s, items: s.items.filter((i) => BEER.test(fold(i.nombre)) && isZeroAlcohol(i.nombre)) };
  return { ...s, items: s.items.filter((i) => isAlcoholic(i.nombre) === (filtro === "con")) };
}

const ASKS_PIZZAS = /\bpizz?a?s?\b|\bpizzeria\b/;
const OTHER_FAMILY = /empanad|bebida|gaseosa|postre|promo|cafe|desayuno|merienda|faina/;

/**
 * Cuando el cliente pregunta por las pizzas, la respuesta tiene que traer TODAS las secciones de pizzas de la carta
 * («Pizzas» y «Pizzas especiales», donde está la Cuatro Quesos). El modelo a veces copia solo la primera: si el borrador
 * muestra pizzas de la carta pero le falta alguna línea, se reemplaza por el texto armado en código con todas las secciones.
 * Si el borrador no lista pizzas (una pregunta, otro tema) se deja como está.
 */
export function completePizzaReply(draft: string, turnText: string, carta: readonly CartaSeccion[]): string {
  const q = fold(turnText);
  if (!ASKS_PIZZAS.test(q) || OTHER_FAMILY.test(q)) return draft;
  const secciones = cartaSectionsFor(carta, "pizzas").filter((s) => s.items.length > 0);
  if (secciones.length < 2) return draft;
  const d = fold(draft);
  const nombres = secciones.flatMap((s) => s.items.map((i) => fold(i.nombre)));
  if (!nombres.some((n) => d.includes(n))) return draft;
  if (nombres.every((n) => d.includes(n))) return draft;
  return `${secciones.map(formatCartaSeccion).join("\n\n")}\n\n¿Querés pedir alguna?`;
}
