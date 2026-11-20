import { NextRequest, NextResponse } from "next/server";
import { guardSuperOwner } from "@/lib/auth/adminGuard";
import { isDemoMode } from "@/lib/demo/mode";
import { actorFromSession, dataBackend, dataDeletionApp, type Actor } from "@/lib/data";
import { executeApi, listApi, type DeletionPort } from "@/lib/deletion/api";
import { accountDeletedNotifier } from "@/lib/deletion/notify";

// Eliminación de usuarios de la app (el personal del panel). SOLO el dueño principal (SUPER_OWNER_EMAIL): otro dueño, un gerente o un
// cajero reciben 403 (la capa de datos lo vuelve a verificar contra la base). Solo se borra la cuenta de acceso: el historial no se toca.
// Requiere D1 y el secreto DATA_DELETION_HASH_SECRET (sin él, 503 con un mensaje claro).
//   GET [?email=]  → el personal que se puede elegir (o el del email exacto) y los pedidos recientes (sin datos personales).
//   POST           → ejecuta: { userId, token (de la vista previa), password (la del dueño), confirmEmail (el del usuario) }.
// La vista previa y su código de un solo uso están en ./vista-previa.

const UNAVAILABLE = "La eliminación de usuarios solo está disponible con la base D1.";
const available = () => dataBackend() === "d1" && !isDemoMode();
const port: DeletionPort<Actor> = dataDeletionApp;
const NO_STORE = { "cache-control": "no-store" };

export async function GET(req: NextRequest) {
  const guard = await guardSuperOwner(req, 30);
  if ("error" in guard) return guard.error;
  if (!available()) return NextResponse.json({ error: UNAVAILABLE }, { status: 501 });
  try {
    const actor = actorFromSession({ userId: guard.user.id, role: "admin" });
    const r = await listApi(port, { isSuperOwner: true }, actor, { email: req.nextUrl.searchParams.get("email") ?? undefined });
    return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
  } catch (error: unknown) {
    console.error("[admin/eliminar-datos] listar", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "No se pudo leer la lista de usuarios." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardSuperOwner(req, 5);
  if ("error" in guard) return guard.error;
  if (!available()) return NextResponse.json({ error: UNAVAILABLE }, { status: 501 });
  try {
    const actor = actorFromSession({ userId: guard.user.id, role: "admin" });
    const r = await executeApi(port, { isSuperOwner: true }, actor, await req.json().catch(() => null), await accountDeletedNotifier());
    return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
  } catch (error: unknown) {
    console.error("[admin/eliminar-datos] eliminar", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "No se pudo eliminar al usuario. Revisá el registro antes de reintentar." }, { status: 500 });
  }
}
