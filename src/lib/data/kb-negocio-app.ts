/** `kb_negocio` desde la app: binding D1 único (getDb). Las rutas no tocan el binding directo. */
import type { Actor } from "./actor.ts";
import { createKb, deleteKb, listKb, updateKb, type KbEntry, type KbInput } from "./kb-negocio.ts";
import { previewFaqImport, saveFaqImport, type FaqImportResult, type FaqImportRow } from "./kb-importar.ts";
import type { FaqItem } from "../kb/faq-file.ts";
import type { SqlDatabase } from "./sql.ts";

async function appDb(): Promise<SqlDatabase> {
  const { getDb } = await import("./db.ts");
  return getDb();
}

export const kbApp = {
  list: async (actor: Actor): Promise<KbEntry[]> => listKb(await appDb(), actor),
  create: async (actor: Actor, input: KbInput): Promise<KbEntry> => createKb(await appDb(), actor, crypto.randomUUID(), input),
  update: async (actor: Actor, id: string, patch: Partial<KbInput>): Promise<KbEntry | null> => updateKb(await appDb(), actor, id, patch),
  remove: async (actor: Actor, id: string): Promise<boolean> => deleteKb(await appDb(), actor, id),
  /** Carga por archivo: vista previa con los duplicados marcados y guardado en lote (categoría faq). */
  importPreview: async (actor: Actor, items: readonly FaqItem[]): Promise<{ rows: FaqImportRow[]; existentes: number }> =>
    previewFaqImport(await appDb(), actor, items),
  importSave: async (actor: Actor, items: readonly FaqItem[], opts: { reemplazar: boolean }): Promise<FaqImportResult> =>
    saveFaqImport(await appDb(), actor, items, opts, () => crypto.randomUUID()),
};
