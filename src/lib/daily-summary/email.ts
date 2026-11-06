export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type EmailBody = Omit<EmailMessage, "from">;

/** Interfaz mínima de envío: el resto del resumen diario no sabe qué proveedor hay detrás. */
export interface EmailSender {
  readonly provider: "cloudflare" | "resend";
  readonly from: string;
  send(message: EmailBody): Promise<void>;
}

/** Forma mínima del binding `send_email` de Workers (Cloudflare Email Sending). */
export interface CloudflareEmailBinding {
  send(message: EmailMessage): Promise<unknown>;
}

export type EnvLike = Readonly<Record<string, string | undefined>>;

/** Remitente por defecto: casilla del local en el dominio onboardeado en Cloudflare. */
export const DEFAULT_EMAIL_FROM = "contacto@la-gambeta.com";

const SEND_TIMEOUT_MS = 15_000;

export function cloudflareSender(binding: CloudflareEmailBinding, from: string): EmailSender {
  return {
    provider: "cloudflare",
    from,
    async send(message) {
      await binding.send({ from, ...message });
    },
  };
}

export function resendSender(apiKey: string, from: string, fetchImpl: typeof fetch = fetch): EmailSender {
  return {
    provider: "resend",
    from,
    async send(message) {
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, ...message, to: [message.to] }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`El servicio de correo respondió ${res.status}.`);
    },
  };
}

/**
 * Elige el proveedor: Cloudflare Email Sending si el binding `EMAIL` está disponible; si no, Resend
 * solo cuando hay `RESEND_API_KEY`; si no hay ninguno devuelve null y los mails se omiten.
 * Remitente: `notif_email_from` de Configuración, luego `RESUMEN_EMAIL_FROM`, luego el por defecto.
 */
export function resolveEmailSender(
  configuredFrom: string | undefined,
  options: { binding?: CloudflareEmailBinding | null; env?: EnvLike } = {},
): EmailSender | null {
  const env = options.env ?? process.env;
  const from = configuredFrom?.trim() || env.RESUMEN_EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM;
  if (options.binding) return cloudflareSender(options.binding, from);
  const apiKey = env.RESEND_API_KEY?.trim();
  return apiKey ? resendSender(apiKey, from) : null;
}
