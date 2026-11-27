import { NextRequest, NextResponse } from "next/server";
import { previewPublish } from "@/lib/gambeta/publish";
import { publishDeps, runPublishAs } from "@/lib/gambeta/publish-server";
import { gambetaMessage, guard, serverError } from "@/lib/gambeta/server";

/** Vista previa de lo que se publicaría ahora + la última corrida. */
export async function GET(req: NextRequest) {
  const { denied, actor } = await guard(req, 20);
  if (denied || !actor) return denied;
  try {
    const deps = await publishDeps(actor);
    const lastRun = await deps.store.lastRun();
    if (!deps.client.hasKey) return NextResponse.json({ hasKey: false, lines: [], warnings: [], opCount: 0, lastRun });
    try {
      const plan = await previewPublish(deps);
      return NextResponse.json({ hasKey: true, lines: plan.lines, warnings: plan.warnings, opCount: plan.ops.length, lastRun });
    } catch (err) {
      return NextResponse.json({ hasKey: true, error: gambetaMessage(err), lines: [], warnings: [], opCount: 0, lastRun });
    }
  } catch (err) {
    return serverError("vista previa de publicación", err);
  }
}

/** «Publicar ahora». */
export async function POST(req: NextRequest) {
  const { denied, actor } = await guard(req, 5);
  if (denied || !actor) return denied;
  try {
    const outcome = await runPublishAs(actor, { trigger: "manual" });
    if (outcome.status === "sin_clave") return NextResponse.json({ error: "Falta cargar la clave de la API del sitio web." }, { status: 400 });
    if (outcome.status === "ocupado") return NextResponse.json({ error: "Ya hay una publicación en curso. Probá en unos minutos." }, { status: 409 });
    return NextResponse.json({ success: true, ...outcome });
  } catch (err) {
    return serverError("publicar", err);
  }
}
