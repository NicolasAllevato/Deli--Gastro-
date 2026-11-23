/**
 * Carga en la base local del simulador los datos reales exportados de producción (menú, carta, opciones, config,
 * conocimiento y zonas) para que el bot vea lo mismo que en producción. No hay clientes, pedidos ni mensajes reales.
 */
import { existsSync, readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

export type DatosReales = Record<string, Record<string, unknown>[]>;

/** Orden de inserción: primero lo que otras tablas referencian. */
const TABLAS = [
  "categories", "products", "carta_secciones", "carta_items", "fudo_modifier_groups", "fudo_modifier_options",
  "fudo_product_groups", "global_config", "kb_negocio", "delivery_zones",
] as const;

export function leerDatosReales(file: URL): DatosReales {
  if (!existsSync(file)) throw new Error("Faltan los datos reales: corré `node --no-warnings scripts/simulador/exportar-datos-reales.ts`.");
  return JSON.parse(readFileSync(file, "utf8")) as DatosReales;
}

/** Inserta cada fila con las columnas que existen en el esquema local (las demás se ignoran). Devuelve cuántas filas por tabla. */
export function cargarDatosReales(db: { raw: DatabaseSync }, datos: DatosReales): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const tabla of TABLAS) {
    const filas = datos[tabla] ?? [];
    const locales = new Set((db.raw.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[]).map((c) => c.name));
    for (const fila of filas) {
      const cols = Object.keys(fila).filter((c) => locales.has(c));
      db.raw.prepare(`INSERT OR REPLACE INTO ${tabla} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((c) => fila[c] as never));
    }
    counts[tabla] = filas.length;
  }
  return counts;
}
