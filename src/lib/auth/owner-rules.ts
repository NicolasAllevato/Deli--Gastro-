/**
 * Quién puede tocar a quién entre los usuarios del personal. Módulo PURO (lo usan la capa de datos y las pruebas).
 *
 * Hay un dueño principal ("superdueño"), identificado por el email de la variable de entorno SUPER_OWNER_EMAIL
 * (secreto o variable del Worker; nunca en el código). Reglas:
 * - Un dueño (staff_role admin) solo lo edita el superdueño o él mismo. Otro dueño recibe 403.
 * - Un dueño que no es el principal puede cambiar su nombre y su contraseña (con la actual). No su rol ni bloquearse.
 * - El superdueño no se bloquea ni se degrada, ni por otros ni por sí mismo.
 * - Solo el superdueño crea dueños o promueve a alguien a dueño. Los demás dueños gestionan gerentes y cajeros.
 * - Sin SUPER_OWNER_EMAIL no hay superdueño: nadie edita a otro dueño ni crea dueños; cada dueño solo se edita a sí
 *   mismo y gestiona gerentes y cajeros (modo seguro).
 * - El actor de sistema (tareas internas, nunca una sesión) cuenta como superdueño, salvo para degradar o bloquear al principal.
 */
import { normalizeStaffRole, type StaffRole } from "./permissions.ts";

export const SUPER_OWNER_ENV = "SUPER_OWNER_EMAIL";

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Email del superdueño desde el entorno, normalizado; null si no está configurado. */
export function superOwnerEmailFrom(env: Readonly<Record<string, string | undefined>>): string | null {
  const raw = env[SUPER_OWNER_ENV]?.trim();
  return raw ? normalizeEmail(raw) : null;
}

/** ¿Este email es el del superdueño configurado? Sin configuración, nadie lo es. */
export function isSuperOwnerEmail(email: string | null | undefined, superOwnerEmail: string | null): boolean {
  return superOwnerEmail !== null && typeof email === "string" && normalizeEmail(email) === normalizeEmail(superOwnerEmail);
}

/** Quien hace el cambio, ya resuelto desde la base. `id` es null para el actor de sistema. */
export interface RuleActor {
  id: string | null;
  isOwner: boolean;
  isSuper: boolean;
}

export interface RuleTarget {
  id: string;
  staffRole: StaffRole;
  isSuper: boolean;
}

/** Lo que pide cambiar (solo lo que las reglas miran; la contraseña actual se verifica en la capa de datos). */
export interface RulePatch {
  staffRole?: StaffRole;
  banned?: boolean;
}

export type RuleViolation = { status: 400 | 403; error: string };

export const SYSTEM_ACTOR: RuleActor = { id: null, isOwner: true, isSuper: true };

const NOT_OWNER = "Solo un dueño puede gestionar usuarios.";
const OWNER_EDIT = "Solo el dueño principal puede modificar a otro dueño.";
const SUPER_PROTECTED = "El dueño principal no se puede bloquear ni cambiar de rol.";
const SELF_PROTECTED = "No podés cambiar tu propio rol ni bloquearte.";
const OWNER_CREATE = "Solo el dueño principal puede crear dueños o promover a alguien a dueño.";

/** Resuelve el actor a partir de su fila de usuario (rol de panel, no bloqueado). */
export function actorFromRow(
  row: { id: string; email: string; staffRole: unknown; banned: boolean },
  superOwnerEmail: string | null,
): RuleActor {
  const isOwner = !row.banned && normalizeStaffRole(row.staffRole) === "admin";
  return { id: row.id, isOwner, isSuper: isOwner && isSuperOwnerEmail(row.email, superOwnerEmail) };
}

/** ¿Puede abrir la edición de este usuario? (para habilitar o deshabilitar el botón; el servidor valida igual) */
export function canEditTarget(actor: RuleActor, target: Pick<RuleTarget, "id" | "staffRole">): boolean {
  if (!actor.isOwner) return false;
  if (actor.id !== null && actor.id === target.id) return true;
  return target.staffRole !== "admin" || actor.isSuper;
}

/** ¿Puede crear un usuario con este rol? */
export function createViolation(actor: RuleActor, staffRole: StaffRole): RuleViolation | null {
  if (!actor.isOwner) return { status: 403, error: NOT_OWNER };
  if (staffRole === "admin" && !actor.isSuper) return { status: 403, error: OWNER_CREATE };
  return null;
}

/**
 * ¿Puede aplicar este cambio sobre este usuario? Devuelve el motivo del rechazo o null.
 * 403 = no tiene permiso para tocarlo; 400 = el cambio pedido no está permitido sobre uno mismo.
 */
export function editViolation(actor: RuleActor, target: RuleTarget, patch: RulePatch): RuleViolation | null {
  const nextRole = patch.staffRole ?? target.staffRole;
  const demotes = nextRole !== "admin";
  const bans = patch.banned === true;

  // El principal es intocable, también para sí mismo y para el sistema.
  if (target.isSuper && (demotes || bans)) return { status: 403, error: SUPER_PROTECTED };
  if (!actor.isOwner) return { status: 403, error: NOT_OWNER };

  const self = actor.id !== null && actor.id === target.id;
  if (self) {
    return (patch.staffRole !== undefined && patch.staffRole !== target.staffRole) || bans
      ? { status: 400, error: SELF_PROTECTED }
      : null;
  }

  if (target.staffRole === "admin" && !actor.isSuper) return { status: 403, error: OWNER_EDIT };
  if (nextRole === "admin" && target.staffRole !== "admin" && !actor.isSuper) return { status: 403, error: OWNER_CREATE };
  return null;
}
