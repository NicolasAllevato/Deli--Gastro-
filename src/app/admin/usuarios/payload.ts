import { SECTIONS, STAFF_ROLES, type Permissions, type StaffRole } from "@/lib/auth/permissions";
import type { StaffUserPublic } from "@/lib/staff-users/types";

export interface UserFormState {
  name: string;
  email: string;
  password: string;
  /** Contraseña actual: solo cuando uno cambia la suya. */
  currentPassword: string;
  role: StaffRole;
  permissions: Permissions;
  banned: boolean;
}

/**
 * Roles que ofrece el selector. "Dueño" solo lo ve el dueño principal (único que crea dueños o promueve a alguien);
 * si el usuario ya es dueño se muestra igual para que el selector deshabilitado refleje su rol.
 */
export function selectableRoles(viewerIsSuperOwner: boolean, originalRole: StaffRole | null): StaffRole[] {
  return STAFF_ROLES.filter((r) => r !== "admin" || viewerIsSuperOwner || originalRole === "admin");
}

/** Cuerpo del alta. El dueño no manda permisos (son fijos). */
export function buildCreateBody(form: UserFormState): Record<string, unknown> {
  return {
    name: form.name.trim(),
    email: form.email.trim(),
    password: form.password,
    staff_role: form.role,
    ...(form.role === "admin" ? {} : { permissions: form.permissions }),
  };
}

/**
 * Cuerpo de la edición: solo lo que cambió. Si cambia el rol o algún permiso se manda el juego completo
 * (el servidor guarda únicamente lo que difiere de los defaults del rol). Vacío = no hay nada para guardar.
 */
export function buildPatchBody(original: StaffUserPublic, form: UserFormState): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (form.name.trim() !== original.name) body.name = form.name.trim();
  if (form.role !== original.staff_role) body.staff_role = form.role;
  const permissionsChanged = SECTIONS.some((s) => form.permissions[s] !== original.permissions[s]);
  if (form.role !== "admin" && (form.role !== original.staff_role || permissionsChanged)) body.permissions = form.permissions;
  if (form.banned !== original.banned) body.banned = form.banned;
  if (form.password) {
    body.password = form.password;
    if (form.currentPassword) body.current_password = form.currentPassword;
  }
  return body;
}
