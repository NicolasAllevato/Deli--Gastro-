/**
 * Aviso por mail al local cuando el bot registra un reclamo nuevo o una consulta que no pudo responder.
 * Lo dispara el Worker del bot por la llamada interna firmada `/api/internal/bot/reclamo` (con nonce).
 * Proveedor: el mismo del resumen diario (Cloudflare Email Sending o Resend); destinatarios: los activos con
 * mail del resumen diario (Configuración → Notificaciones). Sin proveedor o sin destinatarios no se manda nada
 * y `notified_at` queda vacío: el ticket igual aparece en el panel con su contador y su aviso.
 * Una consulta sin respuesta (ver `esConsulta`) lleva su propio mail y NUNCA pide una sugerencia de compensación.
 */
import type { ReclamoAvisoContexto } from "@/lib/data";
import type { EmailSender } from "@/lib/daily-summary/email";
import { CATEGORIA_LABEL, esConsulta, textoConsulta, type Categoria } from "./categoria.ts";

export type AvisoResultado = "enviado" | "sin-proveedor" | "sin-destinatarios" | "ya-avisado" | "no-existe" | "fallo";

export interface AvisoDeps {
  contexto(id: string): Promise<ReclamoAvisoContexto | null>;
  sender(emailFrom: string | undefined): Promise<EmailSender | null>;
  marcar(id: string, detalle: string): Promise<boolean>;
  appUrl: string;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const linkAlPanel = (appUrl: string, id: string) => `${appUrl.replace(/\/+$/, "")}/admin/reclamos?id=${encodeURIComponent(id)}`;

/** Mail del reclamo (o de la consulta sin respuesta, con su propio texto): sin teléfono completo del cliente (solo los últimos 4 dígitos). */
export function renderAviso(ctx: ReclamoAvisoContexto, appUrl: string): { subject: string; text: string; html: string } {
  if (esConsulta(ctx.reclamo)) return renderAvisoConsulta(ctx, appUrl);
  const r = ctx.reclamo;
  const cat = CATEGORIA_LABEL[r.categoria as Categoria] ?? r.categoria;
  const link = linkAlPanel(appUrl, r.id);
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

/** Mail de una consulta que el bot no supo responder: no es un reclamo (sin pedido, categoría ni fotos), hay que contestarla. */
function renderAvisoConsulta(ctx: ReclamoAvisoContexto, appUrl: string): { subject: string; text: string; html: string } {
  const r = ctx.reclamo;
  const link = linkAlPanel(appUrl, r.id);
  const cliente = `${r.client_name ?? "Cliente"} (tel. …${r.client_phone.slice(-4)})`;
  const pregunta = textoConsulta(r.motivo);
  const lines = [
    `Consulta pendiente de respuesta #${r.numero}`,
    "El bot no pudo responder esta consulta de un cliente: hay que contestarle.",
    `Cliente: ${cliente}`,
    `Qué preguntó: ${pregunta}`,
    "",
    `Responderla desde el panel: ${link}`,
  ];
  const html = `<h2>Consulta pendiente de respuesta #${r.numero}</h2>
<p>El bot no pudo responder esta consulta de un cliente: hay que contestarle.</p>
<p><strong>Cliente:</strong> ${escapeHtml(cliente)}</p>
<p><strong>Qué preguntó:</strong> ${escapeHtml(pregunta)}</p>
<p><a href="${escapeHtml(link)}">Responderla desde el panel</a></p>`;
  return { subject: `[${ctx.businessName}] Consulta pendiente de respuesta #${r.numero}`, text: lines.join("\n"), html };
}

/** Manda el aviso una sola vez por ticket. Nunca tira: el resultado dice qué pasó. */
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

export interface AvisoYSugerenciaDeps extends AvisoDeps {
  /** Pide una sugerencia nueva al agente de reclamos (en segundo plano). Solo se llama para reclamos. */
  sugerir(id: string): Promise<void>;
}

/**
 * Lo que hace la app cuando el bot avisa de un ticket nuevo o actualizado: mail al local (propio de reclamo o de consulta)
 * y, SOLO si es un reclamo, una sugerencia nueva del agente. Una consulta sin respuesta no llama a OpenAI ni sugiere
 * compensación. Nunca tira.
 */
export async function avisarYSugerir(id: string, deps: AvisoYSugerenciaDeps): Promise<AvisoResultado> {
  let loaded: ReclamoAvisoContexto | null;
  try {
    loaded = await deps.contexto(id);
  } catch (error: unknown) {
    console.error("[reclamos] aviso", error instanceof Error ? error.message : error);
    return "fallo";
  }
  if (!loaded) return "no-existe";
  const ctx = loaded;
  const resultado = await avisarReclamoNuevo(id, { ...deps, contexto: async () => ctx });
  if (!esConsulta(ctx.reclamo)) await deps.sugerir(id);
  return resultado;
}
