// Copia de cada aceptación de Términos/Privacidad en el Panel de control de OPSYN
// (`POST /api/webhooks/agentes-ia/[clienteId]/aceptaciones`, con el token del agente IA del cliente).
// El registro que vale sigue siendo `legal_acceptances`: si el Panel no responde, la aceptación
// del usuario no se frena, solo se registra el error.

const REQUEST_TIMEOUT_MS = 8_000;
const APP_NAME = "deli-gastro";

type Env = Readonly<Record<string, string | undefined>>;

export interface PanelConfig {
  url: string;
  clienteId: string;
  token: string;
}

export interface PanelAcceptance {
  userId: string;
  email: string | null;
  role: string | null;
  document: string;
  version: string;
  acceptedAt: string;
  ip: string | null;
  userAgent: string | null;
}

/** Datos del Panel; null si falta alguno (el envío queda apagado). */
export function panelConfigFromEnv(env: Env = process.env): PanelConfig | null {
  const url = env.PANEL_CONTROL_URL?.trim().replace(/\/+$/, "");
  const clienteId = env.PANEL_CONTROL_CLIENTE_ID?.trim();
  const token = env.PANEL_CONTROL_TOKEN?.trim();
  return url && clienteId && token ? { url, clienteId, token } : null;
}

export function panelPayload(a: PanelAcceptance) {
  return {
    app: APP_NAME,
    usuario_id: a.userId,
    email: a.email,
    rol: a.role,
    documento: a.document,
    version: a.version,
    aceptado_at: a.acceptedAt,
    ip: a.ip,
    user_agent: a.userAgent,
  };
}

/** Manda la aceptación al Panel. Devuelve true si el Panel la registró. Nunca lanza. */
export async function sendAcceptanceToPanel(
  acceptance: PanelAcceptance,
  cfg: PanelConfig | null = panelConfigFromEnv(),
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!cfg) return false;
  try {
    const res = await fetchImpl(
      `${cfg.url}/api/webhooks/agentes-ia/${encodeURIComponent(cfg.clienteId)}/aceptaciones`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.token}` },
        body: JSON.stringify(panelPayload(acceptance)),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!res.ok) console.error("[legal] el Panel rechazó la aceptación", res.status);
    return res.ok;
  } catch (error: unknown) {
    console.error("[legal] no se pudo enviar la aceptación al Panel", error);
    return false;
  }
}
