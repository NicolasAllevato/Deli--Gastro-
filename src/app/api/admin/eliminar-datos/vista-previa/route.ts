import { NextRequest, NextResponse } from "next/server";
import { guardSuperOwner } from "@/lib/auth/adminGuard";
import { isDemoMode } from "@/lib/demo/mode";
import { actorFromSession, dataBackend, dataDeletionApp, type Actor } from "@/lib/data";
import { previewApi, type DeletionPort } from "@/lib/deletion/api";

// Vista previa de la eliminación de un usuario del personal: nombre, email, rol, qué se borra (con conteos) y qué se conserva, más el
// código de un solo uso (HMAC, 5 minutos, atado al dueño y a ese usuario) que exige la ejecución. SOLO el dueño principal. No cambia nada.
//   POST { userId }

const available = () => dataBackend() === "d1" && !isDemoMode();
const port: DeletionPort<Actor> = dataDeletionApp;

export async function POST(req: NextRequest) {
  const guard = await guardSuperOwner(req, 20);
  if ("error" in guard) return guard.error;
  if (!available()) return NextResponse.json({ error: "La eliminación de usuarios solo está disponible con la base D1." }, { status: 501 });
  try {
    const actor = actorFromSession({ userId: guard.user.id, role: "admin" });
    const r = await previewApi(port, { isSuperOwner: true }, actor, await req.json().catch(() => null));
    return NextResponse.json(r.body, { status: r.status, headers: { "cache-control": "no-store" } });
  } catch (error: unknown) {
    console.error("[admin/eliminar-datos] vista previa", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "No se pudo hacer la vista previa." }, { status: 500 });
  }
}
