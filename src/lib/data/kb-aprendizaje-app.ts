/** Aprendizaje del asistente desde la app: binding D1 único (getDb). Las rutas no tocan el binding directo. */
import type { Actor } from "./actor.ts";
import { decide, listErrores, listSugerencias, type Decision, type KbError, type KbSugerencia } from "./kb-aprendizaje.ts";
import type { SqlDatabase } from "./sql.ts";

async function appDb(): Promise<SqlDatabase> {
  const { getDb } = await import("./db.ts");
  return getDb();
}

export const kbAprendizajeApp = {
  list: async (actor: Actor): Promise<{ sugerencias: KbSugerencia[]; errores: KbError[] }> => {
    const db = await appDb();
    const [sugerencias, errores] = await Promise.all([listSugerencias(db, actor), listErrores(db, actor)]);
    return { sugerencias, errores };
  },
  decide: async (actor: Actor, d: Decision): Promise<boolean> => decide(await appDb(), actor, d, () => crypto.randomUUID()),
};
