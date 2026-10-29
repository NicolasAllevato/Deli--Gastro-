import type { createAdminClient } from "@/utils/supabase/admin";
import { decideSave, loadMapping, saveMapping, saveSchema, type FudoCatalogItem, type MappingState } from "@/lib/fudo/mapping";

type Db = ReturnType<typeof createAdminClient>;

export type SaveResponse =
  | { status: 200; body: MappingState & { requeued: number } }
  | { status: 400; body: { error: string } };

/**
 * Lógica de la ruta PUT/POST de `/api/admin/fudo-map`, separada del handler para poder probarla.
 * `catalog` es el catálogo COMPLETO de Fudo (con inactivos); vacío = no disponible (se deja guardar).
 */
export async function processSaveRequest(db: Db, rawBody: unknown, catalog: FudoCatalogItem[]): Promise<SaveResponse> {
  const parsed = saveSchema.safeParse(rawBody);
  if (!parsed.success) return { status: 400, body: { error: parsed.error.issues[0]?.message ?? "Datos inválidos." } };

  const decision = decideSave(parsed.data.products, catalog);
  if (!decision.ok) return { status: 400, body: { error: decision.error } };

  const requeued = await saveMapping(db, { ...parsed.data, products: decision.products });
  return { status: 200, body: { ...(await loadMapping(db)), requeued } };
}
