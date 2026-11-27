import { NextRequest, NextResponse } from "next/server";
import { siteLinksApp, SiteLinkError } from "@/lib/data";
import { putLinksSchema, validateAgainstSite } from "@/lib/gambeta/links-input";
import { gambetaClient, gambetaMessage, guard, loadSite, serverError } from "@/lib/gambeta/server";

/** Guarda (o quita, con `site: null`) vínculos. Se validan contra la carta del sitio recién leída. */
export async function PUT(req: NextRequest) {
  const { denied, actor, userId } = await guard(req, 20);
  if (denied || !actor) return denied;
  const parsed = putLinksSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const client = gambetaClient();
  let site;
  try {
    site = await loadSite(client);
  } catch (err) {
    return NextResponse.json({ error: gambetaMessage(err) }, { status: 502 });
  }
  const checked = validateAgainstSite(parsed.data, site.catalog, site.promotions);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  try {
    const result = await siteLinksApp.save(actor, checked.changes, userId);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof SiteLinkError) return NextResponse.json({ error: err.message }, { status: 400 });
    return serverError("guardar vínculos", err);
  }
}
