/**
 * Aviso por mail al local cuando el bot registra un reclamo nuevo.
 * Lo dispara el Worker del bot por la llamada interna firmada `/api/internal/bot/reclamo` (con nonce).
 * Proveedor: el mismo del resumen diario (Cloudflare Email Sending o Resend); destinatarios: los activos con
 * mail del resumen diario (Configuración → Notificaciones). Sin proveedor o sin destinatarios no se manda nada
 * y `notified_at` queda vacío: el reclamo igual aparece en el panel con su contador y su aviso.
 */
import type { ReclamoAvisoContexto } from "@/lib/data";
import type { EmailSender } from "@/lib/daily-summary/email";
import { CATEGORIA_LABEL, type Categoria } from "./categoria.ts";

export type AvisoResultado = "enviado" | "sin-proveedor" | "sin-destinatarios" | "ya-avisado" | "no-existe" | "fallo";

export interface AvisoDeps {
  contexto(id: string): Promise<ReclamoAvisoContexto | null>;
  sender(emailFrom: string | undefined): Promise<EmailSender | null>;
  marcar(id: string, detalle: string): Promise<boolean>;
  appUrl: string;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** Mail del reclamo: sin teléfono completo del cliente (solo los últimos 4 dígitos). */
export function renderAviso(ctx: ReclamoAvisoContexto, appUrl: string): { subject: string; text: string; html: string } {
  const r = ctx.reclamo;
  const cat = CATEGORIA_LABEL[r.categoria as Categoria] ?? r.categoria;
  const link = `${appUrl.replace(/\/+$/, "")}/admin/reclamos?id=${encodeURIComponent(r.id)}`;
  const cliente = `${r.client_name ?? "Cliente"} (tel. …${r.client_phone.slice(-4)})`;
  const pedido = ctx.pedido ? `Pedido #${ctx.pedido.id.slice(0, 8).toUpperCase()}: ${ctx.pedido.items_desc}` : "Sin pedido vinculado";
  const lines = [
    `Nuevo reclamo #${r.numero} (${cat})`,
    `Cliente: ${cliente}`,
    pedido,
    `Qué pasó: ${r.motivo}`,
    `Fotos: ${r.foto_keys.length}`,
    "",
    `Verlo en el panel: ${link}`,
  ];
  const html = `<h2>Nuevo reclamo #${r.numero} · ${escapeHtml(cat)}</h2>
<p><strong>Cliente:</strong> ${escapeHtml(cliente)}<br><strong>${escapeHtml(pedido)}</strong></p>
<p><strong>Qué pasó:</strong> ${escapeHtml(r.motivo)}</p>
<p>Fotos: ${r.foto_keys.length}</p>
<p><a href="${escapeHtml(link)}">Abrir el reclamo en el panel</a></p>`;
  return { subject: `[${ctx.businessName}] Reclamo #${r.numero}: ${cat}`, text: lines.join("\n"), html };
}

/** Manda el aviso una sola vez por reclamo. Nunca tira: el resultado dice qué pasó. */
export async function avisarReclamoNuevo(id: string, deps: AvisoDeps): Promise<AvisoResultado> {
  try {
    const ctx = await deps.contexto(id);
    if (!ctx) return "no-existe";
    if (ctx.reclamo.notified_at) return "ya-avisado";
    if (ctx.destinatarios.length === 0) return "sin-destinatarios";
    const mail = await deps.sender(ctx.emailFrom);
    if (!mail) return "sin-proveedor";
    const body = renderAviso(ctx, deps.appUrl);
    let sent = 0;
    for (const to of ctx.destinatarios) {
      try {
        await mail.send({ to, ...body });
        sent += 1;
      } catch (error: unknown) {
        console.error("[reclamos] falló el mail", error instanceof Error ? error.message : error);
      }
    }
    if (sent === 0) return "fallo";
    await deps.marcar(id, `Aviso por mail a ${sent} destinatario(s)`);
    return "enviado";
  } catch (error: unknown) {
    console.error("[reclamos] aviso", error instanceof Error ? error.message : error);
    return "fallo";
  }
}
