/** Tope de filas por consulta de Supabase. */
export const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

export type Page<Row> = PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;

/**
 * Como `fetchAll`, pero sin perder filas con el mismo `created_at` en el borde de página
 * (pasa con cargas masivas): cada página incluye el instante del cursor (`upTo`, inclusivo) y
 * las repetidas se descartan por `id`. Lanza si no puede traer todo.
 */
export async function fetchAllExact<Row extends { id: string; created_at: string }>(
  page: (upTo: string | null) => Page<Row>,
  pageSize = PAGE_SIZE,
  maxPages = MAX_PAGES,
): Promise<Row[]> {
  const byId = new Map<string, Row>();
  let upTo: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const { data, error } = await page(upTo);
    if (error) throw new Error(`No se pudieron leer los datos de la exportación: ${error.message}`);
    const rows = data ?? [];
    const before = byId.size;
    for (const row of rows) byId.set(row.id, row);
    if (rows.length < pageSize) return [...byId.values()];
    // Página llena sin filas nuevas: hay más empates que el tamaño de página y el cursor no avanza.
    if (byId.size === before) break;
    upTo = rows[rows.length - 1]!.created_at;
  }
  throw new Error("La exportación quedaría incompleta: hay más filas de las que se pueden leer.");
}
