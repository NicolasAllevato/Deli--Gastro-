import {
  createWhatsAppClient,
  exchangeCodeForToken,
  listWabaPhoneNumbers,
  WhatsAppApiError,
  type WhatsAppClient,
} from "./client.ts";
import { signupBodySchema, type SignupBody } from "./embedded-signup.ts";

const ALREADY_REGISTERED = /already|registrad/i;
const DEMO_PHONE_NUMBER_ID = "100000000000001";

/** Lo mínimo que el alta necesita del cliente de WhatsApp (el modo demo inyecta uno simulado). */
export type SignupClient = Pick<
  WhatsAppClient,
  "registerPhone" | "subscribeApp" | "getPhoneInfo" | "getWabaInfo" | "isAppSubscribed"
>;

export interface SignupCredentials {
  accessToken: string;
  phoneNumberId: string;
  wabaId: string;
}

export interface SignupDeps {
  appId: string;
  appSecret: string;
  /** Persiste token e ids (en el servidor: `saveWhatsAppSettings`). `phoneNumberId` puede faltar (409). */
  save: (patch: { accessToken: string; wabaId: string; phoneNumberId?: string }) => Promise<void>;
  /** ¿Ya hay una configuración completa y funcionando? Si sí, un fallo nunca la pisa. */
  hasWorkingConfig: boolean;
  fetchImpl?: typeof fetch;
  /** Modo demo (ver `isDemoSafe`): no canjea el código ni consulta a Meta. */
  demo?: boolean;
  /** Cliente a usar; por defecto el real de la Cloud API con las credenciales temporales. */
  buildClient?: (creds: SignupCredentials) => Promise<SignupClient> | SignupClient;
}

export interface SignupResult {
  phoneNumberId: string;
  client: SignupClient;
}

/** No se pudo elegir el número de la cuenta (0 o más de 1). Se informa con 409 y `code: "phone_resolution"`. */
export class PhoneResolutionError extends Error {
  readonly status = 409;
  readonly code = "phone_resolution";

  constructor(message: string) {
    super(message);
    this.name = "PhoneResolutionError";
  }
}

/** El navegador mandó algo que no cuadra con lo que Meta confirma (400). */
export class SignupValidationError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "SignupValidationError";
  }
}

/**
 * El modo demo solo es seguro con la base en memoria: si hay credenciales reales de Supabase no se usa,
 * para no escribir jamás «demo-token» en una base real.
 */
export function isDemoSafe(env: { demoMode: boolean; supabaseUrl?: string; serviceRoleKey?: string }): boolean {
  return env.demoMode && !env.supabaseUrl?.trim() && !env.serviceRoleKey?.trim();
}

/**
 * Valida el cuerpo y le impone al servidor las reglas de modo:
 * `standard` siempre se acepta (Meta puede terminar como número nuevo aunque la coexistencia esté activa);
 * `coexistence` solo si el interruptor guardado está activo.
 */
export function parseSignupRequest(
  raw: unknown,
  coexistenceEnabled: boolean,
): { ok: true; body: SignupBody } | { ok: false; error: string } {
  const parsed = signupBodySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Solicitud inválida." };
  if (parsed.data.mode === "coexistence" && !coexistenceEnabled) {
    return {
      ok: false,
      error:
        "El servidor tiene la coexistencia desactivada. Activala en «Credenciales», guardá y repetí la conexión; " +
        "o conectá un número nuevo con PIN.",
    };
  }
  return { ok: true, body: parsed.data };
}

/** Traduce un error del alta a la respuesta HTTP. El 409 propio lleva `code`; un 409 de Graph sale como 502. */
export function signupErrorResponse(error: unknown): { status: number; body: { error: string; code?: string } } {
  if (error instanceof PhoneResolutionError) return { status: 409, body: { error: error.message, code: error.code } };
  if (error instanceof SignupValidationError) return { status: 400, body: { error: error.message } };
  if (error instanceof WhatsAppApiError) return { status: 502, body: { error: error.message } };
  return { status: 502, body: { error: "No se pudo completar la conexión con Meta." } };
}

function phoneResolutionMessage(count: number, saved: boolean): string {
  const problem =
    count === 0
      ? "La cuenta de WhatsApp todavía no tiene números (Meta puede tardar unos minutos)."
      : `La cuenta tiene ${count} números y no sabemos cuál usar.`;
  const next = saved
    ? "El token y la cuenta ya quedaron guardados: no hace falta repetir el inicio de sesión. " +
      "Cargá el Phone Number ID a mano en «Credenciales», guardá y probá la conexión."
    : "Tu configuración actual no se modificó. Para cambiar de número, repetí la conexión cuando la cuenta tenga un solo número.";
  return `${problem} ${next}`;
}

async function resolvePhoneNumberId(
  body: SignupBody,
  accessToken: string,
  deps: SignupDeps,
  fetchImpl: typeof fetch,
): Promise<string> {
  const numbers = await listWabaPhoneNumbers({ accessToken, wabaId: body.wabaId }, fetchImpl);

  if (body.phoneNumberId) {
    // El navegador no es de fiar: el número tiene que figurar en la cuenta que acaba de autorizar el token.
    if (!numbers.some((n) => n.id === body.phoneNumberId)) {
      throw new SignupValidationError("El número informado no pertenece a la cuenta de WhatsApp autorizada. No se guardó nada.");
    }
    return body.phoneNumberId;
  }

  const [only] = numbers;
  if (numbers.length === 1 && only) return only.id;

  // 0 o >1: se guardan token y cuenta solo si no hay una configuración que funcione.
  const shouldSave = !deps.hasWorkingConfig;
  if (shouldSave) await deps.save({ accessToken, wabaId: body.wabaId });
  throw new PhoneResolutionError(phoneResolutionMessage(numbers.length, shouldSave));
}

/**
 * Cierra el alta: canjea el código por el token del negocio, verifica que el número sea de esa cuenta,
 * registra (solo modo estándar, con PIN) y suscribe la app con un cliente temporal, y recién entonces persiste.
 * Así un alta fallida no pisa una configuración que funciona. El código y el token nunca se loguean.
 */
export async function completeSignup(body: SignupBody, deps: SignupDeps): Promise<SignupResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const accessToken = deps.demo
    ? "demo-token"
    : await exchangeCodeForToken({ appId: deps.appId, appSecret: deps.appSecret, code: body.code }, fetchImpl);

  const phoneNumberId = deps.demo
    ? (body.phoneNumberId ?? DEMO_PHONE_NUMBER_ID)
    : await resolvePhoneNumberId(body, accessToken, deps, fetchImpl);

  const creds: SignupCredentials = { accessToken, phoneNumberId, wabaId: body.wabaId };
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
  await deps.save(creds);
  return { phoneNumberId, client };
}
