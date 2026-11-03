/**
 * Un producto vinculado a Fudo (`products.fudo_id`) toma de Fudo el nombre, el precio, la disponibilidad
 * y la categoría: si se editaran acá, la próxima sincronización lo pisaría. La app solo conserva foto,
 * descripción y puntos. Ver supabase/migrations/022_fudo_catalogo.sql.
 */
export const FUDO_MANAGED_FIELDS = ["name", "price", "is_active", "category_id"] as const;
/** En las categorías Fudo solo manda el nombre: visibilidad, descripción y puntos siguen siendo de la app. */
export const FUDO_MANAGED_CATEGORY_FIELDS = ["name"] as const;

export interface StrippedPatch<T> {
  patch: Partial<T>;
  /** Campos que venían en el pedido y se descartaron por estar gobernados por Fudo. */
  ignored: string[];
}

export function stripFudoManaged<T extends object>(
  patch: T,
  fudoId: number | null,
  fields: readonly string[] = FUDO_MANAGED_FIELDS,
): StrippedPatch<T> {
  if (fudoId === null) return { patch: { ...patch }, ignored: [] };
  const managed = new Set<string>(fields);
  const kept = Object.fromEntries(Object.entries(patch).filter(([key]) => !managed.has(key)));
  const ignored = Object.keys(patch).filter((key) => managed.has(key));
  return { patch: kept as Partial<T>, ignored };
}
