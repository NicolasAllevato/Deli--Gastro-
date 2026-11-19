/**
 * Usuarios del personal del local (D1 + Better Auth): alta, edición y listado.
 * Tienen `role = 'admin'` (acceso al portal) y los limita `staff_role` + `permissions` (migración 0018).
 *
 * Reglas que se resuelven acá, no en la ruta:
 * - Solo se tocan filas con role 'admin'. Los repartidores se gestionan en Pedidos > Repartidores.
 * - Quién puede tocar a quién (dueño principal, otros dueños, uno mismo): src/lib/auth/owner-rules.ts. El actor se
 *   resuelve desde la base (nunca de un dato que mande el pedido) y el email del dueño principal llega en `opts`.
 * - Un dueño puede cambiar su nombre y su contraseña (pidiendo la actual); no su rol ni bloquearse.
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
import {
  SYSTEM_ACTOR, actorFromRow, canEditTarget, createViolation, editViolation, isSuperOwnerEmail,
  type RuleActor, type RuleTarget,
} from "../auth/owner-rules.ts";
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
  /** Es el dueño principal (el del email de SUPER_OWNER_EMAIL). */
  isSuperOwner: boolean;
  /** Quien consulta puede abrir su edición (para habilitar el botón; el servidor valida igual). */
  canEdit: boolean;
}

/** Quién consulta, para la pantalla. */
export interface StaffViewer {
  isSuperOwner: boolean;
  /** false = SUPER_OWNER_EMAIL sin configurar: nadie edita a otro dueño ni crea dueños. */
  superOwnerConfigured: boolean;
}

/** Configuración que viene del entorno (la lee staff-users-app; en pruebas se pasa directo). */
export interface StaffRulesOptions {
  superOwnerEmail: string | null;
}
const NO_SUPER_OWNER: StaffRulesOptions = { superOwnerEmail: null };

/** Repartidor: solo lectura desde esta pantalla (sin email: el que tiene es sintético). */
export interface CourierUser {
  id: string;
  name: string;
  banned: boolean;
  createdAt: string;
}

export type UserFailure = { ok: false; status: 400 | 403 | 404 | 409; error: string };
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
  /** Restablece la contraseña (y corta las sesiones). Sobre uno mismo exige `currentPassword`. */
  password?: string;
  /** Contraseña actual: obligatoria solo cuando uno cambia la suya. */
  currentPassword?: string;
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

const isBanned = (r: Pick<UserRow, "banned">) => r.banned === 1 || r.banned === true;

function toStaffUser(r: UserRow, actor: RuleActor, opts: StaffRulesOptions): StaffUser {
  const staffRole = normalizeStaffRole(r.staff_role);
  return {
    id: r.id,
    name: r.name ?? "",
    email: r.email,
    staffRole,
    permissions: resolvePermissions(staffRole, r.permissions),
    banned: isBanned(r),
    createdAt: String(r.createdAt ?? ""),
    isSuperOwner: staffRole === "admin" && isSuperOwnerEmail(r.email, opts.superOwnerEmail),
    canEdit: canEditTarget(actor, { id: r.id, staffRole }),
  };
}

/** Quien hace el pedido, resuelto desde la base. Sin fila de dueño activo no tiene facultades de dueño. */
async function resolveActor(db: SqlDatabase, actor: Actor, opts: StaffRulesOptions): Promise<RuleActor> {
  requireStaff(actor);
  if (actor.kind !== "admin") return SYSTEM_ACTOR;
  const row = await findUserRow(db, actor.userId);
  if (!row || row.role !== "admin") return { id: actor.userId, isOwner: false, isSuper: false };
  return actorFromRow({ id: row.id, email: row.email, staffRole: row.staff_role, banned: isBanned(row) }, opts.superOwnerEmail);
}

export async function listStaffUsers(
  db: SqlDatabase, actor: Actor, opts: StaffRulesOptions = NO_SUPER_OWNER,
): Promise<{ staff: StaffUser[]; couriers: CourierUser[]; viewer: StaffViewer }> {
  const rules = await resolveActor(db, actor, opts);
  const staff = await db.prepare(`SELECT ${COLS} FROM "user" WHERE role = 'admin' ORDER BY name COLLATE NOCASE, email`).all<UserRow>();
  const couriers = await db
    .prepare(`SELECT id, name, banned, createdAt FROM "user" WHERE role = 'repartidor' ORDER BY name COLLATE NOCASE`)
    .all<Pick<UserRow, "id" | "name" | "banned" | "createdAt">>();
  return {
    staff: staff.results.map((r) => toStaffUser(r, rules, opts)),
    couriers: couriers.results.map((c) => ({
      id: c.id,
      name: c.name ?? "",
      banned: isBanned(c),
      createdAt: String(c.createdAt ?? ""),
    })),
    viewer: { isSuperOwner: rules.isSuper && rules.id !== null, superOwnerConfigured: opts.superOwnerEmail !== null },
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

/** ¿La contraseña dada es la actual de la cuenta de contraseña? Usa el verificador de la config real de Better Auth. */
async function currentPasswordMatches(db: SqlDatabase, auth: Auth, userId: string, candidate: string | undefined): Promise<boolean> {
  if (!candidate) return false;
  const account = await db
    .prepare(`SELECT password FROM "account" WHERE userId = ? AND providerId = 'credential'`)
    .bind(userId)
    .first<{ password: string | null }>();
  if (!account?.password) return false;
  return (await auth.$context).password.verify({ hash: account.password, password: candidate });
}

/**
 * Alta de un usuario del personal. Queda con `legal_version` en NULL: acepta Términos y Privacidad en su primer ingreso.
 * Email repetido = 409 (la columna es UNIQUE COLLATE NOCASE).
 */
export async function createStaffUser(
  db: SqlDatabase, auth: Auth, actor: Actor, input: CreateStaffInput, opts: StaffRulesOptions = NO_SUPER_OWNER,
): Promise<UserResult<StaffUser>> {
  const rules = await resolveActor(db, actor, opts);
  const violation = createViolation(rules, input.staffRole);
  if (violation) return fail(violation.status, violation.error);
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
  return row ? { ok: true, value: toStaffUser(row, rules, opts) } : fail(404, "Usuario no encontrado.");
}

// Un UPDATE que deja de ser dueño activo a alguien solo se aplica si queda otro dueño activo.
const ANOTHER_OWNER = `EXISTS (SELECT 1 FROM "user" o WHERE o.id <> ? AND o.role = 'admin' AND COALESCE(o.staff_role, 'admin') = 'admin' AND o.banned = 0)`;

/**
 * Edita a un usuario del personal. Quién puede tocar a quién lo deciden las reglas de owner-rules.ts.
 * Cambiar el rol sin mandar permisos descarta los ajustes anteriores (vuelven los defaults del rol nuevo).
 */
export async function updateStaffUser(
  db: SqlDatabase, auth: Auth, actor: Actor, id: string, patch: UpdateStaffInput, opts: StaffRulesOptions = NO_SUPER_OWNER,
): Promise<UserResult<StaffUser>> {
  const rules = await resolveActor(db, actor, opts);
  const target = await findUserRow(db, id);
  if (!target) return fail(404, "Usuario no encontrado.");
  if (target.role === "repartidor") return fail(400, "Los repartidores se gestionan en Pedidos > Repartidores.");
  if (target.role !== "admin") return fail(404, "Usuario no encontrado.");

  const currentRole = normalizeStaffRole(target.staff_role);
  const currentBanned = isBanned(target);
  const nextRole = patch.staffRole ?? currentRole;
  const nextBanned = patch.banned ?? currentBanned;
  const roleChanged = nextRole !== currentRole;

  const ruleTarget: RuleTarget = {
    id,
    staffRole: currentRole,
    isSuper: currentRole === "admin" && isSuperOwnerEmail(target.email, opts.superOwnerEmail),
  };
  const violation = editViolation(rules, ruleTarget, { staffRole: patch.staffRole, banned: patch.banned });
  if (violation) return fail(violation.status, violation.error);

  // Quien cambia su propia contraseña tiene que demostrar que conoce la actual.
  const isSelf = rules.id !== null && rules.id === id;
  if (isSelf && patch.password !== undefined && !(await currentPasswordMatches(db, auth, id, patch.currentPassword))) {
    return fail(400, "La contraseña actual no es correcta.");
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
  return row ? { ok: true, value: toStaffUser(row, rules, opts) } : fail(404, "Usuario no encontrado.");
}
