import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { reclamosApp } from "@/lib/data";
import { adminActor } from "@/lib/reclamos/default-deps";
import { leerFoto } from "@/lib/reclamos/server";

const idSchema = z.string().uuid();

/**
 * Foto de un reclamo (bucket privado RECLAMOS). Solo admin, y solo claves que figuran en ese reclamo:
 * no sirve para leer otra cosa del bucket. Sin caché compartida.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await adminActor(req, 240);
  if (actor instanceof NextResponse) return actor;
  const id = idSchema.safeParse((await ctx.params).id);
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!id.success || !key) return NextResponse.json({ error: "Foto inválida." }, { status: 400 });
  const reclamo = await reclamosApp.get(actor, id.data).catch(() => null);
  if (!reclamo || !reclamo.foto_keys.includes(key)) return NextResponse.json({ error: "No se encontró la foto." }, { status: 404 });
  const foto = await leerFoto(key);
  if (!foto) return NextResponse.json({ error: "No se encontró la foto." }, { status: 404 });
  return new NextResponse(foto.body, {
    headers: {
      "content-type": /^image\/(jpeg|png|webp)$/.test(foto.contentType) ? foto.contentType : "application/octet-stream",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
