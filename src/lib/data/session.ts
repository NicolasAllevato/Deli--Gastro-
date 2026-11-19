/**
 * Sesiones con DATA_BACKEND=d1 (etapa 3): Better Auth reemplaza a Supabase Auth.
 * El resto de la app sigue viendo un usuario con forma de Supabase (`app_metadata.role`,
 * `app_metadata.legal_version`), así que guards, proxy y páginas no cambian de contrato.
 *
 * - El rol sale solo de la columna `role` (input:false; G18) y se valida contra AUTH_ROLES.
 * - Un usuario bloqueado (`banned`) no tiene sesión aunque conserve la cookie.
 * - Las funciones "core" reciben auth/db para poder testearlas con node:sqlite.
 */
import { randomUUID } from "node:crypto";
import { createAuth, type Auth } from "./auth.ts";
import { normalizeStaffRole, type StaffRole } from "../auth/permissions.ts";
import { AUTH_ROLES } from "./mirror.ts";
import type { SqlDatabase } from "./sql.ts";

export interface SessionUser {
  id: string;
  email: string;
  /**
   * `staff_role` y `permissions` (JSON crudo) solo vienen en usuarios con rol "admin" (personal del local).
   * Sin `staff_role` se trata como dueño: ver src/lib/auth/permissions.ts.
   */
  app_metadata: { role: string; legal_version?: string; staff_role?: StaffRole; permissions?: string };
  user_metadata: { name?: string };
  aud: string;
  created_at: string;
}

interface AuthUserRow {
  id: string;
  email: string;
  name?: string | null;
  role?: string | null;
  legal_version?: string | null;
  staff_role?: string | null;
  permissions?: string | null;
  banned?: boolean | number | null;
  createdAt?: Date | string;
}

const COURIER_EMAIL_DOMAIN = "repartidores.dely.opsyn.app";

export function toSessionUser(u: AuthUserRow): SessionUser | null {
  if (u.banned === true || u.banned === 1) return null;
  const role = typeof u.role === "string" && AUTH_ROLES.has(u.role) ? u.role : "cliente";
  const staff = role === "admin"
    ? { staff_role: normalizeStaffRole(u.staff_role), ...(u.permissions ? { permissions: u.permissions } : {}) }
    : {};
  return {
    id: u.id,
    email: u.email,
    app_metadata: { role, ...(u.legal_version ? { legal_version: u.legal_version } : {}), ...staff },
    user_metadata: u.name ? { name: u.name } : {},
    aud: "authenticated",
    created_at: new Date(u.createdAt ?? Date.now()).toISOString(),
  };
}

export async function sessionUserWith(auth: Auth, headers: Headers): Promise<SessionUser | null> {
  try {
    const res = await auth.api.getSession({ headers });
    return res?.user ? toSessionUser(res.user as unknown as AuthUserRow) : null;
  } catch (e) {
    console.error("[auth] getSession", e instanceof Error ? e.message : "error");
    return null;
  }
}

/** Marca de Términos aceptados: solo el servidor la escribe. */
export async function setLegalVersionWith(db: SqlDatabase, userId: string, version: string): Promise<boolean> {
  const r = await db
    .prepare(`UPDATE "user" SET legal_version = ?, updatedAt = ? WHERE id = ?`)
    .bind(version, new Date().toISOString(), userId)
    .run();
  return (r.meta?.changes ?? 0) === 1;
}

/** Alta de repartidor: sin cuenta de contraseña (no hay fila en "account"), solo entra por PIN. */
export async function createCourierUserWith(db: SqlDatabase, name: string): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(`INSERT INTO "user" (id, name, email, emailVerified, role, banned, createdAt, updatedAt) VALUES (?, ?, ?, 1, 'repartidor', 0, ?, ?)`)
    .bind(id, name.slice(0, 120), `repartidor-${id.slice(0, 8)}@${COURIER_EMAIL_DOMAIN}`, now, now)
    .run();
  return id;
}

/** Bloquear corta además todas sus sesiones abiertas. Solo toca repartidores. */
export async function setCourierBlockedWith(db: SqlDatabase, userId: string, blocked: boolean): Promise<boolean> {
  const stmts = [
    db.prepare(`UPDATE "user" SET banned = ?, updatedAt = ? WHERE id = ? AND role = 'repartidor'`).bind(blocked ? 1 : 0, new Date().toISOString(), userId),
  ];
  if (blocked) stmts.push(db.prepare(`DELETE FROM "session" WHERE userId = ?`).bind(userId));
  const out = await db.batch(stmts);
  return ((out[0] as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0) === 1;
}

/** Abre la sesión del repartidor (PIN ya validado). Devuelve los Set-Cookie a copiar, o null. */
export async function courierSessionCookiesWith(auth: Auth, userId: string): Promise<string[] | null> {
  try {
    const api = auth.api as unknown as {
      courierSession(args: { body: { userId: string }; returnHeaders: true }): Promise<{ headers: Headers }>;
    };
    const { headers } = await api.courierSession({ body: { userId }, returnHeaders: true });
    const cookies = headers.getSetCookie();
    return cookies.length ? cookies : null;
  } catch (e) {
    console.error("[auth] sesión de repartidor", e instanceof Error ? e.message : "error");
    return null;
  }
}

// --- Entrada de runtime (Worker): D1 + secretos del entorno --------------------------------

export function authBaseURL(env: Record<string, string | undefined> = process.env): string {
  return (env.BETTER_AUTH_URL ?? env.NEXT_PUBLIC_SITE_URL ?? "https://opsyndely.la-gambeta.com").trim().replace(/\/$/, "");
}

/** El dominio principal y su variante www (la app se sirve en los dos). Nunca del Host del request. */
export function trustedOriginsFor(baseURL: string): string[] {
  const url = new URL(baseURL);
  const host = url.hostname.startsWith("www.") ? url.hostname.slice(4) : url.hostname;
  const port = url.port ? `:${url.port}` : "";
  return [`${url.protocol}//${host}${port}`, `${url.protocol}//www.${host}${port}`];
}

export function runtimeAuth(db: SqlDatabase, sendResetPassword?: (to: string, url: string) => Promise<void>): Auth {
  const baseURL = authBaseURL();
  return createAuth({
    database: db,
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL,
    trustedOrigins: trustedOriginsFor(baseURL),
    sendResetPassword,
    turnstileSecret: process.env.TURNSTILE_SECRET_KEY?.trim() || undefined,
  });
}
