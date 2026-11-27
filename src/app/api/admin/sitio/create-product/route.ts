import { NextRequest, NextResponse } from "next/server";
import { CreateProductError, createProductOnSite, createProductSchema } from "@/lib/gambeta/create-product";
import { publishDeps } from "@/lib/gambeta/publish-server";
import { guard, serverError } from "@/lib/gambeta/server";

/** Crea en el sitio un producto de la app que no tiene vínculo y lo vincula. */
export async function POST(req: NextRequest) {
  const { denied, actor, userId } = await guard(req, 10);
  if (denied || !actor) return denied;
  const parsed = createProductSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  try {
    const deps = await publishDeps(actor);
    if (!deps.client.hasKey) return NextResponse.json({ error: "Falta cargar la clave de la API del sitio web." }, { status: 400 });
    const result = await createProductOnSite({ ...deps, linkedBy: userId }, parsed.data);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof CreateProductError) return NextResponse.json({ error: err.message }, { status: err.status });
    return serverError("crear producto en el sitio", err);
  }
}
