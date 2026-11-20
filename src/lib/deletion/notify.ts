/** Aviso por email al usuario eliminado ("tu cuenta fue eliminada"), con el sistema de correo que ya usa la app (Cloudflare Email Sending o Resend). */
import { resolveEmailSender } from "@/lib/daily-summary/email";
import { getEmailBinding } from "@/lib/daily-summary/email-binding";
import { BRAND } from "@/lib/brand";
import type { Notifier } from "./api.ts";

export interface DeletedEmail {
  subject: string;
  text: string;
  html: string;
}

export function buildDeletedEmail(): DeletedEmail {
  const contact = BRAND.contactEmail;
  return {
    subject: `Tu cuenta de ${BRAND.appName} fue eliminada`,
    text: `Tu usuario de ${BRAND.appName} fue eliminado y ya no podés ingresar.\n\nSi no lo pediste vos, escribinos a ${contact}.`,
    html: `<p>Tu usuario de ${BRAND.appName} fue eliminado y ya no podés ingresar.</p><p>Si no lo pediste vos, escribinos a <a href="mailto:${contact}">${contact}</a>.</p>`,
  };
}

/**
 * Función que manda el aviso, o undefined si no hay proveedor de correo (el aviso se omite). Si el envío falla, la capa de datos
 * lo registra y el borrado sigue siendo válido.
 */
export async function accountDeletedNotifier(): Promise<Notifier | undefined> {
  const sender = resolveEmailSender(undefined, { binding: await getEmailBinding() });
  if (!sender) return undefined;
  return async (to) => sender.send({ to, ...buildDeletedEmail() });
}
