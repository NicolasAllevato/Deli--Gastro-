import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireAuth, isAuthorizationError } from "@/lib/auth/requireRole";
import { isDemoMode } from "@/lib/demo/mode";
import { dataBackend, dataDeletionApp, type Actor } from "@/lib/data";
import { authCookiesToExpire, deleteOwnApi, eligibilityApi, type DeletionPort } from "@/lib/deletion/api";
import { accountDeletedNotifier } from "@/lib/deletion/notify";

// Eliminar la propia cuenta: SOLO el personal del local (rol admin). Clientes y repartidores reciben 403: los clientes piden la baja por
// email. Pide la contraseña actual y la palabra ELIMINAR; borra de inmediato solo la cuenta de acceso (el historial no se toca), cierra la
// sesión, avisa por email y deja el registro (canal "autoservicio"). El dueño principal y el último dueño activo no pueden. El usuario sale
// siempre de la sesión del servidor, nunca del cuerpo. Requiere D1 y DATA_DELETION_HASH_SECRET.
//   GET  → ¿puede eliminar su cuenta? (para mostrar u ocultar el botón; el servidor valida igual al ejecutar)
//   POST → { password, confirm: "ELIMINAR" }

const UNAVAILABLE = "La eliminación de la cuenta solo está disponible con la base D1.";
const available = () => dataBackend() === "d1" && !isDemoMode();
const port: DeletionPort<Actor> = dataDeletionApp;
const NO_STORE = { "cache-control": "no-store" };

export async function GET(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 30, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }
  const auth = await requireAuth(req);
  if (isAuthorizationError(auth)) return auth.error;
  if (!available()) return NextResponse.json({ error: UNAVAILABLE }, { status: 501 });
  try {
    const r = await eligibilityApi(port, { userId: auth.user.id, role: auth.role });
    return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
  } catch (error: unknown) {
    console.error("[account/delete] elegibilidad", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "No se pudo verificar." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // Tope por IP además del bloqueo por cuenta que lleva la capa de datos tras varias contraseñas incorrectas.
  if (!(await rateLimit(getClientIp(req), 5, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }
  const auth = await requireAuth(req);
  if (isAuthorizationError(auth)) return auth.error;
  if (!available()) return NextResponse.json({ error: UNAVAILABLE }, { status: 501 });
  try {
    const notify = auth.role === "admin" ? await accountDeletedNotifier() : undefined;
    const r = await deleteOwnApi(port, { userId: auth.user.id, role: auth.role }, await req.json().catch(() => null), notify);
    const res = NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
    if (r.status === 200) {
      // La sesión ya no existe en la base; se vencen también las cookies para no dejar un navegador con una cookie muerta.
      for (const name of authCookiesToExpire(req.cookies.getAll().map((c) => c.name))) {
        res.cookies.set(name, "", { maxAge: 0, path: "/", secure: true, httpOnly: true, sameSite: "lax" });
      }
    }
    return res;
  } catch (error: unknown) {
    console.error("[account/delete] eliminar", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "No se pudo eliminar la cuenta. Probá de nuevo." }, { status: 500 });
  }
}
