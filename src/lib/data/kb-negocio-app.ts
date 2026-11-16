/** `kb_negocio` desde la app: binding D1 único (getDb). Las rutas no tocan el binding directo. */
import type { Actor } from "./actor.ts";
import { createKb, deleteKb, listKb, updateKb, type KbEntry, type KbInput } from "./kb-negocio.ts";
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
};
