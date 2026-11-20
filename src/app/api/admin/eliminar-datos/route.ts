import { NextRequest, NextResponse } from "next/server";
import { guardSuperOwner } from "@/lib/auth/adminGuard";
import { isDemoMode } from "@/lib/demo/mode";
import { actorFromSession, dataBackend, dataDeletionApp, type Actor } from "@/lib/data";
import { executeApi, previewApi, type DeletionPort } from "@/lib/deletion/api";
import { reclamosFileStore } from "@/lib/deletion/files";

// Eliminación de datos personales por teléfono o email. SOLO el dueño principal (SUPER_OWNER_EMAIL): otro dueño, un gerente
// o un cajero reciben 403. La capa de datos vuelve a verificarlo contra la base. Requiere D1.
//   GET                  → pedidos recientes (sin datos personales).
//   GET ?phone= | ?email= → previsualización: cuántos registros hay por tabla (solo conteos), más los recientes.
//   POST                 → ejecuta; el cuerpo trae la palabra de confirmación.

const UNAVAILABLE = "La eliminación de datos solo está disponible con la base D1.";
const available = () => dataBackend() === "d1" && !isDemoMode();
const port: DeletionPort<Actor> = dataDeletionApp;

export async function GET(req: NextRequest) {
  const guard = await guardSuperOwner(req, 30);
  if ("error" in guard) return guard.error;
  if (!available()) return NextResponse.json({ error: UNAVAILABLE }, { status: 501 });
  try {
    const params = req.nextUrl.searchParams;
    const actor = actorFromSession({ userId: guard.user.id, role: "admin" });
    const r = await previewApi(port, { isSuperOwner: true }, actor, {
      phone: params.get("phone") ?? undefined,
      email: params.get("email") ?? undefined,
    });
    return NextResponse.json(r.body, { status: r.status, headers: { "cache-control": "no-store" } });
  } catch (error: unknown) {
    console.error("[admin/eliminar-datos] previsualizar", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "No se pudo previsualizar." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardSuperOwner(req, 5);
  if ("error" in guard) return guard.error;
  if (!available()) return NextResponse.json({ error: UNAVAILABLE }, { status: 501 });
  try {
    const actor = actorFromSession({ userId: guard.user.id, role: "admin" });
    const r = await executeApi(port, { isSuperOwner: true }, actor, await req.json().catch(() => null), await reclamosFileStore());
    return NextResponse.json(r.body, { status: r.status, headers: { "cache-control": "no-store" } });
  } catch (error: unknown) {
    console.error("[admin/eliminar-datos] eliminar", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "No se pudieron eliminar los datos. Revisá el registro antes de reintentar." }, { status: 500 });
  }
}
