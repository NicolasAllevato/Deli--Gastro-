/**
 * Fudo simulado del modo demo: un catálogo en memoria con la MISMA forma que devuelve la API pública
 * real (JSON:API: `data[].attributes` y `relationships`), para que el sync local ejercite los parsers de
 * verdad. Se parte de la carta del demo con diferencias a propósito, para ver cada caso del sync:
 *   - dos precios distintos a los de la app,
 *   - tres productos que la app tiene SIN vincular (se vinculan por nombre),
 *   - dos productos nuevos que la app no tiene,
 *   - un modificador (sellAlone=false) y una categoría de opciones, que no deben llegar a la carta,
 *   - un producto viejo inactivo, que tampoco debe crearse.
 * Vive en `globalThis` como el store del demo y se reinicia con él. No toca disco ni red.
 */

export interface DemoFudoProduct {
  id: number;
  name: string;
  price: number;
  active: boolean;
  sellAlone: boolean;
  categoryId: number;
}

export interface DemoFudoCategory {
  id: number;
  name: string;
}

export interface DemoFudoState {
  categories: DemoFudoCategory[];
  products: DemoFudoProduct[];
  nextId: number;
}

/** Categorías de Fudo (ids de ejemplo). «Opciones» es una categoría de modificadores: el sync la excluye. */
const FUDO_CATEGORIES: readonly DemoFudoCategory[] = [
  { id: 11, name: "Hamburguesas" },
  { id: 12, name: "Pizzas" },
  { id: 13, name: "Acompañamientos" },
  { id: 14, name: "Bebidas" },
  { id: 15, name: "Postres" },
  { id: 16, name: "Opciones" },
];

/** id de categoría de Fudo según el nombre de la categoría de la app (para vincular el seed). */
export const DEMO_FUDO_CATEGORY_ID_BY_NAME: Readonly<Record<string, number>> = Object.fromEntries(
  FUDO_CATEGORIES.map((c) => [c.name, c.id]),
);

// [id, nombre, precio, activo, sellAlone, categoría]
const FUDO_PRODUCTS: ReadonlyArray<readonly [number, string, number, boolean, boolean, number]> = [
  [101, "Hamburguesa Clásica", 8500, true, true, 11],
  [102, "Hamburguesa Doble BBQ", 11900, true, true, 11], // en la app: 11200
  [103, "Hamburguesa Veggie", 8900, true, true, 11],
  [104, "Pizza Margarita", 12900, true, true, 12], // en la app: 12000
  [105, "Pizza Napolitana", 12800, true, true, 12],
  [106, "Pizza Pepperoni", 13500, true, true, 12],
  [107, "Papas Fritas con Cheddar", 5000, true, true, 13], // la app lo tiene sin vincular
  [108, "Aros de Cebolla", 4200, true, true, 13], // idem
  [109, "Limonada con Menta", 2600, true, true, 14],
  [110, "Cerveza Artesanal IPA", 4300, true, true, 14],
  [111, "Volcán de Cacao", 5600, true, true, 15], // la app lo tiene sin vincular
  [112, "Cheesecake de Frutos Rojos", 5200, false, true, 15],
  [113, "Hamburguesa Bacon", 9800, true, true, 11], // nuevo: la app no lo tiene
  [114, "Pizza Fugazzeta", 13900, true, true, 12], // nuevo: la app no lo tiene
  [115, "Extra cheddar", 500, true, false, 16], // modificador: no es un plato
  [116, "Menú viejo", 3000, false, true, 11], // inactivo y viejo: no se crea
];

/** id de producto de Fudo según el nombre en la carta del demo (para vincular el seed). */
export const DEMO_FUDO_PRODUCT_ID_BY_NAME: Readonly<Record<string, number>> = Object.fromEntries(
  FUDO_PRODUCTS.map(([id, name]) => [name, id]),
);

/** Productos que el seed deja ya vinculados a Fudo; el resto de la app queda manual hasta el primer sync. */
export const DEMO_LINKED_PRODUCT_NAMES: readonly string[] = [
  "Hamburguesa Clásica",
  "Hamburguesa Doble BBQ",
  "Hamburguesa Veggie",
  "Pizza Margarita",
  "Pizza Napolitana",
  "Pizza Pepperoni",
  "Limonada con Menta",
  "Cerveza Artesanal IPA",
];

/** Categorías que el seed deja vinculadas (Acompañamientos queda manual para ver el vínculo por nombre). */
export const DEMO_LINKED_CATEGORY_NAMES: readonly string[] = ["Hamburguesas", "Pizzas", "Bebidas", "Postres"];

/** Ids de medios de pago de Fudo (los del local real) para el mapeo del demo. */
export const DEMO_FUDO_PAYMENT_IDS: Readonly<Record<string, number>> = { Efectivo: 1, Tarjeta: 6, "Mercado Pago": 14 };

function initialState(): DemoFudoState {
  return {
    categories: FUDO_CATEGORIES.map((c) => ({ ...c })),
    products: FUDO_PRODUCTS.map(([id, name, price, active, sellAlone, categoryId]) => ({ id, name, price, active, sellAlone, categoryId })),
    nextId: 200,
  };
}

const GLOBAL_KEY = "__deliGastroDemoFudo" as const;
type GlobalWithFudo = typeof globalThis & { [GLOBAL_KEY]?: DemoFudoState };

export function getDemoFudo(): DemoFudoState {
  const g = globalThis as GlobalWithFudo;
  g[GLOBAL_KEY] ??= initialState();
  return g[GLOBAL_KEY];
}

export function resetDemoFudo(): void {
  (globalThis as GlobalWithFudo)[GLOBAL_KEY] = initialState();
}

/** Respuesta de `GET /products` de la API pública de Fudo (JSON:API). */
export function demoFudoProductsPayload(): unknown {
  return {
    data: getDemoFudo().products.map((p) => ({
      type: "Product",
      id: String(p.id),
      attributes: { name: p.name, price: p.price, active: p.active, sellAlone: p.sellAlone },
      relationships: { productCategory: { data: { type: "ProductCategory", id: String(p.categoryId) } } },
    })),
  };
}

/** Respuesta de `GET /product-categories` de la API pública de Fudo (JSON:API). */
export function demoFudoCategoriesPayload(): unknown {
  return { data: getDemoFudo().categories.map((c) => ({ type: "ProductCategory", id: String(c.id), attributes: { name: c.name } })) };
}

export type DemoFudoChange = "precios" | "nuevo" | "apagar";

const SELLABLE = (p: DemoFudoProduct): boolean => p.sellAlone && p.categoryId !== 16;
const round100 = (n: number): number => Math.round(n / 100) * 100;

/** Cambia algo en el Fudo simulado, como si alguien lo hubiera editado en Fudo. Devuelve qué hizo. */
export function simulateFudoChange(kind: DemoFudoChange): { message: string } {
  const state = getDemoFudo();
  if (kind === "precios") {
    const targets = state.products.filter((p) => SELLABLE(p) && p.active).slice(0, 4);
    for (const p of targets) p.price = round100(p.price * 1.1);
    return { message: `Subió un 10 % el precio de ${targets.length} productos en Fudo (${targets.map((p) => p.name).join(", ")}).` };
  }
  if (kind === "nuevo") {
    const id = state.nextId++;
    const name = `Promo del día ${id - 199}`;
    state.products.push({ id, name, price: 15000, active: true, sellAlone: true, categoryId: 12 });
    return { message: `Se agregó «${name}» ($15.000) en Fudo.` };
  }
  const target = state.products.find((p) => SELLABLE(p) && p.active);
  if (!target) return { message: "No hay productos activos para apagar en Fudo." };
  target.active = false;
  return { message: `Se apagó «${target.name}» en Fudo.` };
}
