/**
 * Aviso por email al dar de baja una cuenta, con el sistema de correo que ya usa la app (Cloudflare Email Sending o Resend).
 * El cliente recibe "tu cuenta fue dada de baja y no vas a recibir más promociones"; el personal, "tu cuenta fue eliminada".
 */
import { resolveEmailSender } from "@/lib/daily-summary/email";
import { getEmailBinding } from "@/lib/daily-summary/email-binding";
import { BRAND } from "@/lib/brand";
import type { Notifier } from "./api.ts";

export interface DeletedEmail {
  subject: string;
  text: string;
  html: string;
}

/** Texto según el rol de la cuenta dada de baja (`cliente` o el personal del local). */
export function buildDeletedEmail(role = "admin"): DeletedEmail {
  const contact = BRAND.contactEmail;
  const help = `Si no lo pediste vos, escribinos a ${contact}.`;
  const helpHtml = `Si no lo pediste vos, escribinos a <a href="mailto:${contact}">${contact}</a>.`;
  if (role === "cliente") {
    return {
      subject: `Tu cuenta de ${BRAND.appName} fue dada de baja`,
      text: `Tu cuenta de ${BRAND.appName} fue dada de baja y no vas a recibir más promociones. Ya no podés ingresar con ella.\n\nSi querés frenar cualquier mensaje promocional en tu número de WhatsApp, respondé BAJA.\n\nConservamos el historial de tus pedidos por motivos contables y legales.\n\n${help}`,
      html: `<p>Tu cuenta de ${BRAND.appName} fue dada de baja y no vas a recibir más promociones. Ya no podés ingresar con ella.</p><p>Si querés frenar cualquier mensaje promocional en tu número de WhatsApp, respondé BAJA.</p><p>Conservamos el historial de tus pedidos por motivos contables y legales.</p><p>${helpHtml}</p>`,
    };
  }
  return {
    subject: `Tu cuenta de ${BRAND.appName} fue eliminada`,
    text: `Tu usuario de ${BRAND.appName} fue eliminado y ya no podés ingresar.\n\n${help}`,
    html: `<p>Tu usuario de ${BRAND.appName} fue eliminado y ya no podés ingresar.</p><p>${helpHtml}</p>`,
  };
}

/**
 * Función que manda el aviso, o undefined si no hay proveedor de correo (el aviso se omite). Si el envío falla, la capa de datos
 * lo registra y la baja sigue siendo válida.
 */
export async function accountDeletedNotifier(): Promise<Notifier | undefined> {
  const sender = resolveEmailSender(undefined, { binding: await getEmailBinding() });
  if (!sender) return undefined;
  return async ({ email, role }) => sender.send({ to: email, ...buildDeletedEmail(role) });
}
