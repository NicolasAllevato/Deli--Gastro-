/** Publicación al sitio desde la app: binding D1 único (getDb). Las rutas y el ejecutor no tocan el binding directo. */
import type { Actor } from "./actor.ts";
import { createPublishStore, type PublishStore } from "./site-publish.ts";
import { setPushedImage } from "./site-links.ts";
import type { SqlDatabase } from "./sql.ts";

async function appDb(): Promise<SqlDatabase> {
  const { getDb } = await import("./db.ts");
  return getDb();
}

export const sitePublishApp = {
  store: async (actor: Actor): Promise<PublishStore> => createPublishStore(await appDb(), actor),
  markPushedImage: async (actor: Actor, appProductId: string, url: string): Promise<boolean> =>
    setPushedImage(await appDb(), actor, appProductId, url),
};
