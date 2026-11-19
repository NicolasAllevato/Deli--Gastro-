import type { Permissions, StaffRole } from "@/lib/auth/permissions";

/** Igual que MIN_PASSWORD de la config de Better Auth (src/lib/data/auth.ts). */
export const STAFF_MIN_PASSWORD = 10;

/** Forma pública de un usuario del personal en /api/admin/usuarios (sin hash ni columnas internas). */
export interface StaffUserPublic {
  id: string;
  name: string;
  email: string;
  staff_role: StaffRole;
  /** Permisos efectivos (rol + ajustes). */
  permissions: Permissions;
  banned: boolean;
  createdAt: string;
}

/** Repartidor: solo lectura (sin email: el que tiene es sintético). */
export interface CourierView {
  id: string;
  name: string;
  banned: boolean;
  createdAt: string;
}

export interface StaffUsersListing {
  users: StaffUserPublic[];
  couriers: CourierView[];
  /** Quien consulta: la pantalla no deja que se bloquee ni se cambie el rol a sí mismo. */
  currentUserId: string;
}
