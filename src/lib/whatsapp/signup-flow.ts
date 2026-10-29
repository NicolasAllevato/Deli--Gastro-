import {
  createWhatsAppClient,
  exchangeCodeForToken,
  listWabaPhoneNumbers,
  WhatsAppApiError,
  type WhatsAppClient,
} from "./client.ts";
import type { SignupBody } from "./embedded-signup.ts";

const ALREADY_REGISTERED = /already|registrad/i;

type CoexistenceBody = Extract<SignupBody, { mode: "coexistence" }>;

/** Lo mínimo que el alta necesita del cliente de WhatsApp (el modo demo inyecta uno simulado). */
export type SignupClient = Pick<
  WhatsAppClient,
  "registerPhone" | "subscribeApp" | "getPhoneInfo" | "getWabaInfo" | "isAppSubscribed"
>;

export interface SignupDeps {
  appId: string;
  appSecret: string;
  /** Persiste token e ids (en el servidor: `saveWhatsAppSettings`). */
  save: (patch: { accessToken: string; phoneNumberId: string; wabaId: string }) => Promise<void>;
  fetchImpl?: typeof fetch;
  /** Modo demo: no canjea el código ni consulta a Meta. */
  demo?: boolean;
  /** Cliente a usar después de guardar; por defecto el real de la Cloud API. */
  buildClient?: (creds: { accessToken: string; phoneNumberId: string; wabaId: string }) => Promise<SignupClient> | SignupClient;
}

export interface SignupResult {
  phoneNumberId: string;
  client: SignupClient;
}

async function resolvePhoneNumberId(body: CoexistenceBody, accessToken: string, fetchImpl: typeof fetch): Promise<string> {
  if (body.phoneNumberId) return body.phoneNumberId;
  const numbers = await listWabaPhoneNumbers({ accessToken, wabaId: body.wabaId }, fetchImpl);
  if (numbers.length === 1) return numbers[0].id;
  if (numbers.length === 0) {
    throw new WhatsAppApiError(409, "La cuenta de WhatsApp no tiene números todavía. Esperá unos minutos e intentá de nuevo.");
  }
  throw new WhatsAppApiError(409, "La cuenta tiene más de un número: cargá el Phone Number ID a mano en «Credenciales».");
}

/**
 * Cierra el alta: canjea el código por el token del negocio, guarda token + ids y suscribe la app a la WABA.
 * Modo `standard` registra además el número con el PIN. Modo `coexistence` NO registra (el número ya está
 * registrado) ni pide PIN. El código y el token nunca se loguean.
 */
export async function completeSignup(body: SignupBody, deps: SignupDeps): Promise<SignupResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const accessToken = deps.demo
    ? "demo-token"
    : await exchangeCodeForToken({ appId: deps.appId, appSecret: deps.appSecret, code: body.code }, fetchImpl);

  let phoneNumberId: string;
  if (body.mode === "standard") phoneNumberId = body.phoneNumberId;
  else if (body.phoneNumberId) phoneNumberId = body.phoneNumberId;
  else if (deps.demo) phoneNumberId = "100000000000001";
  else phoneNumberId = await resolvePhoneNumberId(body, accessToken, fetchImpl);

  const creds = { accessToken, phoneNumberId, wabaId: body.wabaId };
  await deps.save(creds);

  const client = deps.buildClient ? await deps.buildClient(creds) : createWhatsAppClient(creds, fetchImpl);
  if (body.mode === "standard") {
    try {
      await client.registerPhone(body.pin);
    } catch (error: unknown) {
      // Registrar dos veces el mismo número no es un error para el dueño.
      if (!(error instanceof Error && ALREADY_REGISTERED.test(error.message))) throw error;
    }
  }
  await client.subscribeApp();
  return { phoneNumberId, client };
}
