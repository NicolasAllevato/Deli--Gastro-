/**
 * Usuarios del personal del local (D1 + Better Auth): alta, edición y listado.
 * Tienen `role = 'admin'` (acceso al portal) y los limita `staff_role` + `permissions` (migración 0018).
 *
 * Reglas que se resuelven acá, no en la ruta:
 * - Solo se tocan filas con role 'admin'. Los repartidores se gestionan en Pedidos > Repartidores.
 * - Nadie se quita a sí mismo el rol de dueño, se bloquea ni se cambia la contraseña por esta vía.
 * - El sistema nunca se queda sin dueño activo: el UPDATE que degrada o bloquea a un dueño lleva la
 *   condición "queda otro dueño activo" dentro del mismo SQL (atómico, sin carrera entre dos pedidos).
 * - Cambiar rol, permisos, bloqueo o contraseña corta las sesiones abiertas de ese usuario. Los permisos
 *   se leen de la base en cada pedido, así que el corte solo asegura que el menú y la sesión se renueven.
 */
import { randomUUID } from "node:crypto";
import {
  SECTIONS, normalizeStaffRole, resolvePermissions, serializePermissions,
  type AccessLevel, type Permissions, type Section, type StaffRole,
} from "../auth/permissions.ts";
import { requireStaff, type Actor } from "./actor.ts";
import type { Auth } from "./auth.ts";
import { nowIso, type SqlDatabase, type SqlStatement, type SqlValue } from "./sql.ts";

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  staffRole: StaffRole;
  /** Permisos efectivos (rol + ajustes). */
  permissions: Permissions;
  banned: boolean;
  createdAt: string;
}

/** Repartidor: solo lectura desde esta pantalla (sin email: el que tiene es sintético). */
export interface CourierUser {
  id: string;
  name: string;
  banned: boolean;
  createdAt: string;
}

export type UserFailure = { ok: false; status: 400 | 404 | 409; error: string };
export type UserResult<T> = { ok: true; value: T } | UserFailure;

export interface CreateStaffInput {
  name: string;
  email: string;
  password: string;
  staffRole: StaffRole;
  /** Ajustes por sección; se guardan solo las que difieren de los defaults del rol. */
  permissions?: Partial<Record<Section, AccessLevel>>;
}

export interface UpdateStaffInput {
  name?: string;
  staffRole?: StaffRole;
  permissions?: Partial<Record<Section, AccessLevel>>;
  banned?: boolean;
  /** Restablece la contraseña (y corta las sesiones). */
  password?: string;
}

interface UserRow {
  id: string;
  name: string | null;
  email: string;
  role: string;
  staff_role: string | null;
  permissions: string | null;
  banned: number | boolean | null;
  createdAt: string | null;
}

const COLS = `id, name, email, role, staff_role, permissions, banned, createdAt`;

const fail = (status: UserFailure["status"], error: string): UserFailure => ({ ok: false, status, error });

function toStaffUser(r: UserRow): StaffUser {
  const staffRole = normalizeStaffRole(r.staff_role);
  return {
    id: r.id,
    name: r.name ?? "",
    email: r.email,
    staffRole,
    permissions: resolvePermissions(staffRole, r.permissions),
    banned: r.banned === 1 || r.banned === true,
    createdAt: String(r.createdAt ?? ""),
  };
}

export async function listStaffUsers(db: SqlDatabase, actor: Actor): Promise<{ staff: StaffUser[]; couriers: CourierUser[] }> {
  requireStaff(actor);
  const staff = await db.prepare(`SELECT ${COLS} FROM "user" WHERE role = 'admin' ORDER BY name COLLATE NOCASE, email`).all<UserRow>();
  const couriers = await db
    .prepare(`SELECT id, name, banned, createdAt FROM "user" WHERE role = 'repartidor' ORDER BY name COLLATE NOCASE`)
    .all<Pick<UserRow, "id" | "name" | "banned" | "createdAt">>();
  return {
    staff: staff.results.map(toStaffUser),
    couriers: couriers.results.map((c) => ({
      id: c.id,
      name: c.name ?? "",
      banned: c.banned === 1 || c.banned === true,
      createdAt: String(c.createdAt ?? ""),
    })),
  };
}

async function findUserRow(db: SqlDatabase, id: string): Promise<UserRow | null> {
  return db.prepare(`SELECT ${COLS} FROM "user" WHERE id = ?`).bind(id).first<UserRow>();
}

const NO_SECTION_ERROR = "Tiene que tener acceso al menos a una sección.";

/** Un usuario que no es dueño y quedaría sin ninguna sección no podría usar el panel. */
function hasAnySection(staffRole: StaffRole, serializedPermissions: string | null): boolean {
  if (staffRole === "admin") return true;
  const resolved = resolvePermissions(staffRole, serializedPermissions);
  return SECTIONS.some((s) => resolved[s] !== "none");
}

const isUniqueViolation = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/i.test(e.message);

/** Hash con el hasher de la config real de Better Auth (el mismo que verifica el login). */
async function hashPassword(auth: Auth, password: string): Promise<string> {
  return (await auth.$context).password.hash(password);
}

/**
 * Alta de un usuario del personal. Queda con `legal_version` en NULL: acepta Términos y Privacidad en su primer ingreso.
 * Email repetido = 409 (la columna es UNIQUE COLLATE NOCASE).
 */
export async function createStaffUser(db: SqlDatabase, auth: Auth, actor: Actor, input: CreateStaffInput): Promise<UserResult<StaffUser>> {
  requireStaff(actor);
  const email = input.email.trim().toLowerCase();
  const taken = await db.prepare(`SELECT id FROM "user" WHERE email = ?`).bind(email).first();
  if (taken) return fail(409, "Ya existe un usuario con ese email.");

  const permissions = serializePermissions(input.staffRole, input.permissions);
  if (!hasAnySection(input.staffRole, permissions)) return fail(400, NO_SECTION_ERROR);

  const id = randomUUID();
  const now = nowIso();
  const passwordHash = await hashPassword(auth, input.password);
  try {
    await db.batch([
      db
        .prepare(`INSERT INTO "user" (id, name, email, emailVerified, role, staff_role, permissions, banned, createdAt, updatedAt) VALUES (?, ?, ?, 1, 'admin', ?, ?, 0, ?, ?)`)
        .bind(id, input.name.trim().slice(0, 120), email, input.staffRole, permissions, now, now),
      db
        .prepare(`INSERT INTO "account" (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, 'credential', ?, ?, ?, ?)`)
        .bind(randomUUID(), id, id, passwordHash, now, now),
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) return fail(409, "Ya existe un usuario con ese email.");
    throw e;
  }
  const row = await findUserRow(db, id);
  return row ? { ok: true, value: toStaffUser(row) } : fail(404, "Usuario no encontrado.");
}

// Un UPDATE que deja de ser dueño activo a alguien solo se aplica si queda otro dueño activo.
const ANOTHER_OWNER = `EXISTS (SELECT 1 FROM "user" o WHERE o.id <> ? AND o.role = 'admin' AND COALESCE(o.staff_role, 'admin') = 'admin' AND o.banned = 0)`;

/**
 * Edita a un usuario del personal. `actor.userId` es quien edita: sobre sí mismo solo puede cambiar el nombre.
 * Cambiar el rol sin mandar permisos descarta los ajustes anteriores (vuelven los defaults del rol nuevo).
 */
export async function updateStaffUser(
  db: SqlDatabase, auth: Auth, actor: Actor, id: string, patch: UpdateStaffInput,
): Promise<UserResult<StaffUser>> {
  requireStaff(actor);
  const target = await findUserRow(db, id);
  if (!target) return fail(404, "Usuario no encontrado.");
  if (target.role === "repartidor") return fail(400, "Los repartidores se gestionan en Pedidos > Repartidores.");
  if (target.role !== "admin") return fail(404, "Usuario no encontrado.");

  const currentRole = normalizeStaffRole(target.staff_role);
  const currentBanned = target.banned === 1 || target.banned === true;
  const nextRole = patch.staffRole ?? currentRole;
  const nextBanned = patch.banned ?? currentBanned;
  const roleChanged = nextRole !== currentRole;

  const isSelf = actor.kind === "admin" && actor.userId === id;
  if (isSelf && (roleChanged || patch.banned === true || patch.password !== undefined)) {
    return fail(400, "No podés cambiar tu propio rol, bloquearte ni restablecer tu contraseña desde acá.");
  }

  const nextPermissions = nextRole === "admin"
    ? null
    : patch.permissions !== undefined
      ? serializePermissions(nextRole, patch.permissions)
      : roleChanged ? null : target.permissions;
  const permissionsChanged = nextPermissions !== (target.permissions ?? null);
  if ((roleChanged || permissionsChanged) && !hasAnySection(nextRole, nextPermissions)) return fail(400, NO_SECTION_ERROR);

  const sets: string[] = [];
  const values: SqlValue[] = [];
  if (patch.name !== undefined && patch.name.trim() !== (target.name ?? "")) {
    sets.push("name = ?");
    values.push(patch.name.trim().slice(0, 120));
  }
  if (roleChanged) {
    sets.push("staff_role = ?");
    values.push(nextRole);
  }
  if (permissionsChanged) {
    sets.push("permissions = ?");
    values.push(nextPermissions);
  }
  if (nextBanned !== currentBanned) {
    sets.push("banned = ?");
    values.push(nextBanned ? 1 : 0);
  }

  const wasActiveOwner = currentRole === "admin" && !currentBanned;
  const demoting = wasActiveOwner && (nextRole !== "admin" || nextBanned);
  const revokeSessions = roleChanged || permissionsChanged || (nextBanned && !currentBanned) || patch.password !== undefined;
  const now = nowIso();

  if (sets.length > 0) {
    const where = demoting ? `id = ? AND role = 'admin' AND ${ANOTHER_OWNER}` : `id = ? AND role = 'admin'`;
    const r = await db
      .prepare(`UPDATE "user" SET ${sets.join(", ")}, updatedAt = ? WHERE ${where}`)
      .bind(...values, now, id, ...(demoting ? [id] : []))
      .run();
    if (r.meta.changes !== 1) {
      return demoting
        ? fail(409, "Tiene que quedar al menos un usuario dueño activo.")
        : fail(404, "Usuario no encontrado.");
    }
  }

  const after: SqlStatement[] = [];
  if (patch.password !== undefined) {
    const hash = await hashPassword(auth, patch.password);
    after.push(
      db.prepare(`UPDATE "account" SET password = ?, updatedAt = ? WHERE userId = ? AND providerId = 'credential'`).bind(hash, now, id),
      // Si no tenía cuenta de contraseña (no debería pasar), se crea.
      db
        .prepare(`INSERT INTO "account" (id, accountId, providerId, userId, password, createdAt, updatedAt) SELECT ?, ?, 'credential', ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM "account" WHERE userId = ? AND providerId = 'credential')`)
        .bind(randomUUID(), id, id, hash, now, now, id),
    );
  }
  if (revokeSessions) after.push(db.prepare(`DELETE FROM "session" WHERE userId = ?`).bind(id));
  if (after.length > 0) await db.batch(after);

  const row = await findUserRow(db, id);
  return row ? { ok: true, value: toStaffUser(row) } : fail(404, "Usuario no encontrado.");
}
