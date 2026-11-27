/** `site_links` desde la app: binding D1 único (getDb). Las rutas no tocan el binding directo. */
import type { Actor } from "./actor.ts";
import {
  listAppProductsForSite, listSiteLinks, removeSiteLink, saveSiteLinks, setProductPhotoIfEmpty,
  type AppProductRow, type SiteLink,
} from "./site-links.ts";
import type { SqlDatabase } from "./sql.ts";

async function appDb(): Promise<SqlDatabase> {
  const { getDb } = await import("./db.ts");
  return getDb();
}

export const siteLinksApp = {
  list: async (actor: Actor): Promise<SiteLink[]> => listSiteLinks(await appDb(), actor),
  products: async (actor: Actor): Promise<AppProductRow[]> => listAppProductsForSite(await appDb(), actor),
  save: async (actor: Actor, changes: Parameters<typeof saveSiteLinks>[2], linkedBy: string | null) =>
    saveSiteLinks(await appDb(), actor, changes, linkedBy),
  remove: async (actor: Actor, appProductId: string): Promise<boolean> => removeSiteLink(await appDb(), actor, appProductId),
  setPhotoIfEmpty: async (actor: Actor, productId: string, url: string): Promise<boolean> =>
    setProductPhotoIfEmpty(await appDb(), actor, productId, url),
};
