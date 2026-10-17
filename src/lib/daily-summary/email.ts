export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailConfig {
  apiKey: string;
  from: string;
}

const SEND_TIMEOUT_MS = 15_000;

/**
 * Configuración del servicio de correo (Resend). Sin `RESEND_API_KEY` o sin remitente
 * (`notif_email_from` de Configuración o `RESUMEN_EMAIL_FROM`) los mails se omiten.
 */
export function emailConfig(
  configuredFrom: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): EmailConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = configuredFrom?.trim() || env.RESUMEN_EMAIL_FROM?.trim();
  return apiKey && from ? { apiKey, from } : null;
}

export async function sendEmail(
  config: EmailConfig,
  message: Omit<EmailMessage, "from">,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: config.from, ...message, to: [message.to] }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`El servicio de correo respondió ${res.status}.`);
}
