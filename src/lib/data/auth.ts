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

export interface AuthEnv {
  /** Binding D1 o, en tests, una base node:sqlite (Better Auth detecta ambos). */
  database: unknown;
  secret: string | undefined;
  baseURL: string;
  trustedOrigins?: string[];
}

export const AUTH_COOKIE_PREFIX = "opsyn";
export const SESSION_TTL_S = 7 * 24 * 60 * 60;
export const SESSION_ROTATE_S = 24 * 60 * 60;
export const MIN_PASSWORD = 10;

export function createAuth(env: AuthEnv) {
  if (!env.secret || env.secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET ausente o corto (>= 32 caracteres, como Worker secret)");
  }
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
      // Recuperación por email (Resend) se conecta en la fase 3; D3: los 7
      // usuarios actuales entran por "olvidé mi contraseña" en el corte.
    },
    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "cliente", input: false },
        // Copiado de Supabase Auth (scripts/copiar-usuarios-d1.mjs); el usuario no lo escribe por la API.
        phone: { type: "string", required: false, input: false },
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
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
