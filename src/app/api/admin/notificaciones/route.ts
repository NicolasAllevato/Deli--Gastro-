import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { canAccessPath, staffAccessOf } from "@/lib/auth/permissions";
import { TEST_PHONE } from "@/lib/agent/settings";
import { nombreSeguro, recortarTexto } from "@/lib/conversaciones/aviso-derivacion";
import { listOrders } from "@/lib/orders-server";
import { listShifts } from "@/lib/courier-shifts";
import { actorFromSession, reclamosApp } from "@/lib/data";
import {
  MAX_NOTIFICACIONES,
  armarNotificaciones,
  deDerivacion,
  deHabilitacion,
  dePedido,
  deReclamo,
  type Notificacion,
} from "@/lib/notificaciones/armado";

type Db = ReturnType<typeof createAdminClient>;

/** Una fuente que falla no tumba la campana: se omite y se loguea. */
async function fuente(nombre: string, leer: () => Promise<Notificacion[]>): Promise<Notificacion[]> {
  try {
    return await leer();
  } catch (error: unknown) {
    console.error(`[admin/notificaciones] fuente ${nombre}`, error);
    return [];
  }
}

async function pedidos(db: Db): Promise<Notificacion[]> {
  const list = await listOrders(db, { statuses: ["Recibidos"], limit: MAX_NOTIFICACIONES });
  return list.map((o) => dePedido({ id: o.id, clientName: o.client_name, total: o.total, createdAt: o.created_at }));
}

/** Misma consulta que /api/admin/conversaciones/derivadas. */
async function derivadas(db: Db): Promise<Notificacion[]> {
  const { data: conversations, error } = await db
    .from("wa_conversations")
    .select("id, client_phone, client_id, contact_name, last_inbound_at, updated_at, created_at")
    .eq("human_takeover", true)
    .neq("client_phone", TEST_PHONE)
    .order("updated_at", { ascending: false })
    .limit(MAX_NOTIFICACIONES);
  if (error) throw new Error(error.message);
  const list = conversations ?? [];
  if (list.length === 0) return [];

  const clientIds = [...new Set(list.map((c) => c.client_id).filter((id): id is string => Boolean(id)))];
  const [{ data: clients }, { data: messages }] = await Promise.all([
    clientIds.length > 0 ? db.from("clients").select("id, name").in("id", clientIds) : Promise.resolve({ data: [] }),
    db
      .from("wa_messages")
      .select("conversation_id, type, body, created_at")
      .in("conversation_id", list.map((c) => c.id))
      .order("created_at", { ascending: false })
      .limit(MAX_NOTIFICACIONES * 5),
  ]);
  const names = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const lastBy = new Map<string, string>();
  for (const m of messages ?? []) {
    if (!lastBy.has(m.conversation_id)) lastBy.set(m.conversation_id, m.body ?? (m.type === "audio" ? "Audio" : "Mensaje"));
  }
  return list.map((c) =>
    deDerivacion({
      id: c.id,
      nombre: nombreSeguro((c.client_id && names.get(c.client_id)) || c.contact_name, c.client_phone),
      desde: c.updated_at ?? c.last_inbound_at ?? c.created_at,
      ultimoMensaje: recortarTexto(lastBy.get(c.id)),
    }),
  );
}

async function reclamos(userId: string, role: Parameters<typeof actorFromSession>[0]["role"]): Promise<Notificacion[]> {
  const actor = actorFromSession({ userId, role });
  const [abiertos, enCurso] = await Promise.all([
    reclamosApp.list(actor, { estado: "abierto" }),
    reclamosApp.list(actor, { estado: "en_curso" }),
  ]);
  return [...abiertos, ...enCurso].map((r) => deReclamo({ id: r.id, estado: r.estado, motivo: r.motivo, createdAt: r.created_at }));
}

async function habilitaciones(db: Db): Promise<Notificacion[]> {
  const shifts = await listShifts(db);
  return shifts
    .filter((s) => s.status === "pending")
    .map((s) => deHabilitacion({ id: s.id, courierName: s.courierName, requestedAt: s.requestedAt }));
}

/**
 * Novedades para la campana del panel. La abre todo el personal; cada fuente se incluye solo si el usuario
 * puede ver su sección (pedidos y habilitaciones → Pedidos; derivadas y reclamos → Comunicación).
 */
export async function GET(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 120, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }
  const auth = await requireRole("admin", req);
  if (isAuthorizationError(auth)) return auth.error;

  const access = staffAccessOf(auth.user.app_metadata);
  const verPedidos = canAccessPath(access, "/admin/tablero");
  const verComunicacion = canAccessPath(access, "/admin/conversaciones");
  const db = createAdminClient();

  const grupos = await Promise.all([
    verPedidos ? fuente("pedidos", () => pedidos(db)) : [],
    verPedidos ? fuente("habilitaciones", () => habilitaciones(db)) : [],
    verComunicacion ? fuente("derivadas", () => derivadas(db)) : [],
    verComunicacion ? fuente("reclamos", () => reclamos(auth.user.id, auth.role)) : [],
  ]);
  return NextResponse.json(armarNotificaciones(grupos));
}
