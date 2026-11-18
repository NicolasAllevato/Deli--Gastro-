/**
 * Carta estructurada (migración 0015): secciones y líneas con el nombre de la carta impresa, una nota y el/los
 * producto(s) de los que sale el precio. Los precios NO se guardan: se leen siempre de `products` (Fudo).
 * Lectura pública (PDF, bot); edición solo admin, reemplazando la carta entera en un batch atómico.
 */
import { z } from "zod";
import { requireStaff, type Actor } from "./actor.ts";
import { fromCents } from "./money.ts";
import { nowIso, type SqlDatabase, type SqlStatement } from "./sql.ts";

export type CartaEstilo = "lista" | "gustos";

/** Producto vinculado con su precio vivo. */
export interface CartaProductoRef {
  id: string;
  nombre: string;
  precio: number;
  activo: boolean;
}

export interface CartaItemVista {
  id: string;
  nombre: string;
  nota: string | null;
  activo: boolean;
  producto_id: string | null;
  producto_id_2: string | null;
  /** Una entrada por columna de precio; null si no hay producto vinculado (o está inactivo, en la vista pública). */
  productos: (CartaProductoRef | null)[];
}

export interface CartaSeccionVista {
  id: string;
  titulo: string;
  columnas: string[];
  estilo: CartaEstilo;
  nota: string | null;
  activo: boolean;
  items: CartaItemVista[];
}

export interface CartaAdminVista {
  secciones: CartaSeccionVista[];
  /** Productos activos y visibles en el portal que no están en ninguna línea activa de la carta. */
  sinVincular: { id: string; nombre: string; precio: number; categoria: string | null }[];
}

export class CartaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CartaError";
  }
}

// --- validación ---------------------------------------------------------------------------------------------
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null));

export const cartaItemInputSchema = z
  .object({
    id: idSchema,
    nombre: z.string().trim().min(1).max(80),
    nota: optionalText(120),
    producto_id: idSchema.nullable().optional().transform((v) => v ?? null),
    producto_id_2: idSchema.nullable().optional().transform((v) => v ?? null),
    activo: z.boolean().default(true),
  })
  .strict();

export const cartaSeccionInputSchema = z
  .object({
    id: idSchema,
    titulo: z.string().trim().min(1).max(80),
    columnas: z.array(z.string().trim().min(1).max(30)).max(2).default([]),
    estilo: z.enum(["lista", "gustos"]).default("lista"),
    nota: optionalText(200),
    activo: z.boolean().default(true),
    items: z.array(cartaItemInputSchema).max(150),
  })
  .strict();

export const cartaInputSchema = z
  .object({ secciones: z.array(cartaSeccionInputSchema).max(40) })
  .strict()
  .superRefine((carta, ctx) => {
    const ids = new Set<string>();
    for (const s of carta.secciones) {
      for (const id of [s.id, ...s.items.map((i) => i.id)]) {
        if (ids.has(id)) ctx.addIssue({ code: "custom", message: `Id repetido: ${id}` });
        ids.add(id);
      }
      if (s.columnas.length < 2 && s.items.some((i) => i.producto_id_2)) {
        ctx.addIssue({ code: "custom", message: `"${s.titulo}" tiene una sola columna: no lleva segundo producto.` });
      }
    }
  });

export type CartaInput = z.infer<typeof cartaInputSchema>;

// --- lectura ------------------------------------------------------------------------------------------------
interface SeccionRow {
  id: string;
  titulo: string;
  columnas: string;
  estilo: CartaEstilo;
  nota: string | null;
  activo: number;
}
interface ItemRow {
  id: string;
  seccion_id: string;
  nombre: string;
  nota: string | null;
  activo: number;
  producto_id: string | null;
  producto_id_2: string | null;
  p1_name: string | null;
  p1_price: number | null;
  p1_active: number | null;
  p2_name: string | null;
  p2_price: number | null;
  p2_active: number | null;
}

function parseColumnas(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 2) : [];
  } catch {
    return [];
  }
}

function ref(id: string | null, name: string | null, cents: number | null, active: number | null, onlyActive: boolean): CartaProductoRef | null {
  if (!id || name === null || cents === null) return null;
  if (onlyActive && active !== 1) return null;
  return { id, nombre: name, precio: fromCents(cents), activo: active === 1 };
}

async function readCarta(db: SqlDatabase, publica: boolean): Promise<CartaSeccionVista[]> {
  const { results: secciones } = await db
    .prepare("SELECT id, titulo, columnas, estilo, nota, activo FROM carta_secciones WHERE activo = 1 OR ? = 0 ORDER BY orden, titulo")
    .bind(publica ? 1 : 0)
    .all<SeccionRow>();
  if (secciones.length === 0) return [];
  const { results: items } = await db
    .prepare(
      `SELECT i.id, i.seccion_id, i.nombre, i.nota, i.activo, i.producto_id, i.producto_id_2,
              p1.name AS p1_name, p1.price_cents AS p1_price, p1.is_active AS p1_active,
              p2.name AS p2_name, p2.price_cents AS p2_price, p2.is_active AS p2_active
       FROM carta_items i
       LEFT JOIN products p1 ON p1.id = i.producto_id
       LEFT JOIN products p2 ON p2.id = i.producto_id_2
       WHERE i.activo = 1 OR ? = 0
       ORDER BY i.orden, i.nombre`,
    )
    .bind(publica ? 1 : 0)
    .all<ItemRow>();
  return secciones.map((s) => {
    const columnas = parseColumnas(s.columnas);
    const cols = Math.max(1, columnas.length);
    return {
      id: s.id,
      titulo: s.titulo,
      columnas,
      estilo: s.estilo === "gustos" ? "gustos" : "lista",
      nota: s.nota,
      activo: s.activo === 1,
      items: items
        .filter((i) => i.seccion_id === s.id)
        .map((i) => ({
          id: i.id,
          nombre: i.nombre,
          nota: i.nota,
          activo: i.activo === 1,
          producto_id: i.producto_id,
          producto_id_2: i.producto_id_2,
          productos: [
            ref(i.producto_id, i.p1_name, i.p1_price, i.p1_active, publica),
            ref(i.producto_id_2, i.p2_name, i.p2_price, i.p2_active, publica),
          ].slice(0, cols),
        })),
    };
  });
}

/** Carta pública (PDF): secciones y líneas activas con al menos un precio de producto activo. Vacía = sin carta. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- lectura pública: el actor queda por contrato de la capa
export async function getCartaPublica(db: SqlDatabase, _actor: Actor): Promise<CartaSeccionVista[]> {
  try {
    // Líneas sin producto o con producto inactivo no se muestran al público (el admin las sigue viendo marcadas).
    return (await readCarta(db, true))
      .map((s) => ({ ...s, items: s.items.filter((i) => i.productos.some((p) => p !== null)) }))
      .filter((s) => s.items.length > 0);
  } catch (err: unknown) {
    // Sin la migración 0015 aplicada: se sigue con la carta por categorías.
    if (err instanceof Error && /no such table/i.test(err.message)) return [];
    throw err;
  }
}

/** Vista del editor: todo (incluye inactivos) y los productos visibles que no están en la carta. */
export async function getCartaAdmin(db: SqlDatabase, actor: Actor): Promise<CartaAdminVista> {
  requireStaff(actor);
  const secciones = await readCarta(db, false);
  const { results } = await db
    .prepare(
      `SELECT p.id, p.name, p.price_cents, c.name AS categoria FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.is_active = 1 AND COALESCE(p.show_in_portal, 1) = 1
         AND NOT EXISTS (
           SELECT 1 FROM carta_items i JOIN carta_secciones s ON s.id = i.seccion_id
           WHERE i.activo = 1 AND s.activo = 1 AND (i.producto_id = p.id OR i.producto_id_2 = p.id))
       ORDER BY c.name, p.name`,
    )
    .all<{ id: string; name: string; price_cents: number; categoria: string | null }>();
  return { secciones, sinVincular: results.map((r) => ({ id: r.id, nombre: r.name, precio: fromCents(r.price_cents), categoria: r.categoria })) };
}

// --- escritura ----------------------------------------------------------------------------------------------
/** Reemplaza la carta entera (orden = posición en el arreglo). Los productos vinculados tienen que existir. */
export async function saveCarta(db: SqlDatabase, actor: Actor, input: CartaInput): Promise<CartaAdminVista> {
  requireStaff(actor);
  const carta = cartaInputSchema.parse(input);
  const productIds = [...new Set(carta.secciones.flatMap((s) => s.items.flatMap((i) => [i.producto_id, i.producto_id_2])).filter((id): id is string => Boolean(id)))];
  for (const id of productIds) {
    const row = await db.prepare("SELECT id FROM products WHERE id = ?").bind(id).first<{ id: string }>();
    if (!row) throw new CartaError(`No existe el producto ${id}.`);
  }
  const now = nowIso();
  const statements: SqlStatement[] = [db.prepare("DELETE FROM carta_items"), db.prepare("DELETE FROM carta_secciones")];
  carta.secciones.forEach((s, si) => {
    statements.push(
      db
        .prepare("INSERT INTO carta_secciones (id, titulo, orden, columnas, estilo, nota, activo, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(s.id, s.titulo, (si + 1) * 10, JSON.stringify(s.columnas), s.estilo, s.nota, s.activo ? 1 : 0, now),
    );
    s.items.forEach((i, ii) => {
      statements.push(
        db
          .prepare(
            "INSERT INTO carta_items (id, seccion_id, nombre, nota, orden, producto_id, producto_id_2, activo, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(i.id, s.id, i.nombre, i.nota, (ii + 1) * 10, i.producto_id, s.columnas.length >= 2 ? i.producto_id_2 : null, i.activo ? 1 : 0, now),
      );
    });
  });
  await db.batch(statements);
  return getCartaAdmin(db, actor);
}

async function appDb(): Promise<SqlDatabase> {
  const { getDb } = await import("./db.ts");
  return getDb();
}

/** Desde la app: binding D1 único. */
export const cartaApp = {
  publica: async (actor: Actor): Promise<CartaSeccionVista[]> => getCartaPublica(await appDb(), actor),
  admin: async (actor: Actor): Promise<CartaAdminVista> => getCartaAdmin(await appDb(), actor),
  save: async (actor: Actor, input: CartaInput): Promise<CartaAdminVista> => saveCarta(await appDb(), actor, input),
};
