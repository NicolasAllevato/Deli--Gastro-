/**
 * Piezas de servidor del flujo de reclamos: aviso por mail, mensajes de WhatsApp al cliente y fotos en R2.
 * Datos SOLO por `@/lib/data`; los bindings que no son D1 (EMAIL, RECLAMOS) se leen del contexto de Cloudflare.
 */
import { createAdminClient } from "@/utils/supabase/admin";
import { reclamosApp, systemActor, type Actor } from "@/lib/data";
import { getEmailBinding } from "@/lib/daily-summary/email-binding";
import { resolveEmailSender } from "@/lib/daily-summary/email";
import { clientFor, loadWhatsAppSettings } from "@/lib/whatsapp/config";
import { WhatsAppApiError } from "@/lib/whatsapp/client";
import { loadOpenAIKey } from "@/lib/agent/settings";
import { avisarReclamoNuevo, type AvisoResultado } from "./notify.ts";
import { ejecutarAgente, type EjecucionResultado } from "./agente.ts";
import { dentroDeVentana } from "./mensajes.ts";

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://opsyndely.la-gambeta.com";

/** Agente de reclamos: genera y guarda la sugerencia. Nunca tira. */
export function sugerirReclamo(id: string): Promise<EjecucionResultado> {
  const actor = systemActor("agente de reclamos");
  return ejecutarAgente(id, {
    datos: (rid) => reclamosApp.contextoAgente(actor, rid),
    apiKey: () => loadOpenAIKey(createAdminClient()),
    guardar: (rid, r) => reclamosApp.guardarSugerencia(actor, rid, r),
  });
}

/** Deja trabajo corriendo después de la respuesta (Workers `waitUntil`); fuera de Cloudflare lo espera. */
async function enSegundoPlano(task: Promise<unknown>): Promise<void> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    getCloudflareContext().ctx.waitUntil(task);
  } catch {
    await task.catch(() => undefined);
  }
}

/**
 * Reclamo nuevo o actualizado (lo llama el endpoint interno del bot): mail al local (una sola vez por reclamo) y
 * sugerencia nueva del agente en segundo plano, así la respuesta al bot no espera a OpenAI.
 */
export async function avisarReclamo(id: string, conversationId: string): Promise<AvisoResultado> {
  const actor = systemActor("aviso de reclamo nuevo (bot)");
  const resultado = await avisoMail(actor, id, conversationId);
  if (resultado !== "no-existe") await enSegundoPlano(sugerirReclamo(id));
  return resultado;
}

function avisoMail(actor: Actor, id: string, conversationId: string): Promise<AvisoResultado> {
  return avisarReclamoNuevo(id, {
    // El reclamo tiene que ser de la conversación firmada: el bot no puede pedir avisos de otros reclamos.
    contexto: async (rid) => {
      const ctx = await reclamosApp.contextoAviso(actor, rid);
      return ctx && ctx.reclamo.conversation_id === conversationId ? ctx : null;
    },
    sender: async (from) => resolveEmailSender(from, { binding: await getEmailBinding() }),
    marcar: (rid, detalle) => reclamosApp.marcarNotificado(actor, rid, detalle),
    appUrl: APP_URL(),
  });
}

export type EnvioResultado = { ok: true } | { ok: false; status: number; error: string };

/** Manda un texto al cliente del reclamo (ventana de 24 h) y lo deja en el historial y en la conversación. */
export async function enviarAlCliente(actor: Actor, id: string, texto: string): Promise<EnvioResultado> {
  const conv = await reclamosApp.conversacion(actor, id);
  if (!conv) return { ok: false, status: 404, error: "No se encontró el reclamo." };
  if (!dentroDeVentana(conv.lastInboundAt)) {
    return { ok: false, status: 409, error: "Pasaron más de 24 h desde el último mensaje del cliente: escribile con una plantilla desde Conversaciones." };
  }
  const wa = clientFor(await loadWhatsAppSettings(createAdminClient()));
  if (!wa) return { ok: false, status: 400, error: "Conectá WhatsApp primero." };
  try {
    const wamid = await wa.sendText(conv.phone, texto);
    await reclamosApp.registrarMensaje(actor, { id, conversationId: conv.conversationId, wamid, texto });
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, status: 502, error: error instanceof WhatsAppApiError ? error.message : "No se pudo enviar el mensaje." };
  }
}

/** Bucket privado de fotos de reclamos (binding `RECLAMOS`). null fuera de Cloudflare o sin binding. */
interface R2Like {
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
}

export async function leerFoto(key: string): Promise<{ body: ReadableStream; contentType: string } | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const bucket = (getCloudflareContext().env as { RECLAMOS?: R2Like }).RECLAMOS;
    const obj = bucket ? await bucket.get(key) : null;
    return obj ? { body: obj.body, contentType: obj.httpMetadata?.contentType ?? "image/jpeg" } : null;
  } catch {
    return null;
  }
}
