/**
 * Better Auth sobre D1 (decisión D2). NO está activo: nada lo importa fuera
 * de la capa y solo se usará con DATA_BACKEND=d1 tras el corte (fase 3).
 *
 * Seguridad:
 * - Cookies HttpOnly + Secure + SameSite=Lax, prefijo propio.
 * - Sesión de 7 días con rotación diaria (updateAge) y revocable en D1.
 * - `role` es campo adicional con input:false (G18): ni sign-up ni
 *   update-user lo aceptan; solo el servidor lo cambia.
 * - Rate limit persistido en D1 (vale entre isolates), más estricto en login,
 *   alta y recuperación. El PIN de repartidor usa pin-attempts.ts.
 * - Secreto BETTER_AUTH_SECRET obligatorio (Worker secret, >= 32 chars).
 * - CSRF: Better Auth valida Origin contra trustedOrigins; se suma al
 *   chequeo CSRF existente de la app.
 */
import { betterAuth } from "better-auth";
import { captcha } from "better-auth/plugins/captcha";
import { courierSessionPlugin } from "./auth-courier.ts";

export interface AuthEnv {
  /** Binding D1 o, en tests, una base node:sqlite (Better Auth detecta ambos). */
  database: unknown;
  secret: string | undefined;
  baseURL: string;
  trustedOrigins?: string[];
  /**
   * Alta abierta por email. Default false: la app no tiene registro público (clientes y
   * repartidores los crea el servidor; los 7 usuarios copiados entran por "olvidé mi contraseña").
   */
  allowSignUp?: boolean;
  /** Envía el link de recuperación. Sin él, /request-password-reset responde igual pero no manda nada. */
  sendResetPassword?: (to: string, url: string) => Promise<void>;
  /**
   * Secreto de Cloudflare Turnstile (Worker secret TURNSTILE_SECRET_KEY). Con él, pedir el link de
   * recuperación exige el token del widget (header x-captcha-response). El login no lo pide.
   */
  turnstileSecret?: string;
}

/** Endpoints protegidos con captcha: solo el pedido de recuperación (anti-bots/spam de emails). */
export const CAPTCHA_ENDPOINTS = ["/request-password-reset", "/forget-password"];

export const AUTH_COOKIE_PREFIX = "opsyn";
export const SESSION_TTL_S = 7 * 24 * 60 * 60;
export const SESSION_ROTATE_S = 24 * 60 * 60;
export const MIN_PASSWORD = 10;
export const RESET_TOKEN_TTL_S = 15 * 60;

export function createAuth(env: AuthEnv) {
  if (!env.secret || env.secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET ausente o corto (>= 32 caracteres, como Worker secret)");
  }
  const sendReset = env.sendResetPassword;
  return betterAuth({
    database: env.database as never,
    secret: env.secret,
    baseURL: env.baseURL,
    trustedOrigins: env.trustedOrigins ?? [env.baseURL],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD,
      maxPasswordLength: 128,
      autoSignIn: false,
      disableSignUp: !env.allowSignUp,
      // Link de un solo uso (Better Auth borra el token al canjearlo), vence a los 15 min y
      // al cambiar la contraseña se cierran todas las sesiones abiertas.
      resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_S,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        if (sendReset) await sendReset(user.email, url);
      },
      // Recuperación por email (Resend) se conecta en la fase 3; D3: los 7
      // usuarios actuales entran por "olvidé mi contraseña" en el corte.
    },
    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "cliente", input: false },
        // Copiado de Supabase Auth (scripts/copiar-usuarios-d1.mjs); el usuario no lo escribe por la API.
        phone: { type: "string", required: false, input: false },
        // Términos aceptados: lo escribe solo /api/legal/acceptances (antes app_metadata).
        legal_version: { type: "string", required: false, input: false },
        // Repartidor desactivado: sessionUser() lo rechaza aunque tenga una sesión vieja.
        banned: { type: "boolean", required: false, defaultValue: false, input: false },
        // Personal del local (migración 0018): rol (admin|gerente|cajero) y ajustes por sección en JSON.
        // Solo los escribe /api/admin/usuarios; el usuario no puede auto-otorgárselos por update-user.
        staff_role: { type: "string", required: false, input: false },
        permissions: { type: "string", required: false, input: false },
      },
    },
    session: {
      expiresIn: SESSION_TTL_S,
      updateAge: SESSION_ROTATE_S,
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rateLimit",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 3 },
        "/forget-password": { window: 300, max: 3 },
        "/request-password-reset": { window: 300, max: 3 },
        "/reset-password": { window: 300, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: true,
      cookiePrefix: AUTH_COOKIE_PREFIX,
      defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: "lax", path: "/" },
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    plugins: [
      courierSessionPlugin(),
      ...(env.turnstileSecret
        ? [captcha({ provider: "cloudflare-turnstile", secretKey: env.turnstileSecret, endpoints: CAPTCHA_ENDPOINTS })]
        : []),
    ],
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
