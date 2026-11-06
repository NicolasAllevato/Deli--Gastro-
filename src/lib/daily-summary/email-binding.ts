import type { CloudflareEmailBinding } from "./email.ts";

/**
 * Binding `EMAIL` (send_email) del Worker. Fuera de Cloudflare (`npm run demo`, dev local) no existe
 * y devuelve null sin ruido: el resumen degrada a Resend si hay clave, o se omite.
 */
export async function getEmailBinding(): Promise<CloudflareEmailBinding | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const binding = (getCloudflareContext().env as { EMAIL?: CloudflareEmailBinding }).EMAIL;
    return binding && typeof binding.send === "function" ? binding : null;
  } catch {
    return null;
  }
}
