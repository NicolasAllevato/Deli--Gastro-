/**
 * Lógica de /api/admin/usuarios, separada de las rutas para poder probarla sin Next.
 * La ruta autentica (sesión, CSRF, límite) y entrega acá el acceso ya resuelto de quien llama;
 * este módulo valida el cuerpo con zod, exige que sea dueño y traduce los resultados de la capa de datos a HTTP.
 */
import { z } from "zod";
import {
  ACCESS_LEVELS, STAFF_ROLES, canManageUsers,
  type AccessLevel, type Permissions, type Section, type StaffAccess, type StaffRole,
} from "@/lib/auth/permissions";
import { STAFF_MIN_PASSWORD, type CourierView, type StaffUserPublic, type StaffUsersListing } from "@/lib/staff-users/types";

export { STAFF_MIN_PASSWORD, type CourierView, type StaffUserPublic, type StaffUsersListing };

const MAX_PASSWORD = 128;

const level = z.enum(ACCESS_LEVELS, { error: "Nivel de acceso inválido." });
const permissionsSchema = z.strictObject(
  {
    dashboard: level.optional(),
    pedidos: level.optional(),
    catalogo: level.optional(),
    comunicacion: level.optional(),
    zonas: level.optional(),
    configuracion: level.optional(),
  },
  { error: "Permisos inválidos." },
);

const passwordSchema = z
  .string({ error: "Poné una contraseña." })
  .min(STAFF_MIN_PASSWORD, `La contraseña tiene que tener al menos ${STAFF_MIN_PASSWORD} caracteres.`)
  .max(MAX_PASSWORD, `La contraseña no puede pasar de ${MAX_PASSWORD} caracteres.`);

const nameSchema = z.string({ error: "Poné un nombre." }).trim().min(1, "Poné un nombre.").max(120, "El nombre es muy largo.");

export const createStaffSchema = z.strictObject({
  name: nameSchema,
  email: z.email({ error: "Email inválido." }).max(254, "Email inválido."),
  password: passwordSchema,
  staff_role: z.enum(STAFF_ROLES, { error: "Rol inválido." }),
  permissions: permissionsSchema.optional(),
});

export const updateStaffSchema = z
  .strictObject({
    name: nameSchema.optional(),
    staff_role: z.enum(STAFF_ROLES, { error: "Rol inválido." }).optional(),
    permissions: permissionsSchema.optional(),
    banned: z.boolean({ error: "Estado inválido." }).optional(),
    password: passwordSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No hay cambios para guardar." });

/** Ids de Better Auth: uuid (los de esta app) o cadenas alfanuméricas propias de la librería. */
export const userIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

// --- Puerto hacia la capa de datos (se inyecta: staffUsersApp en producción, una base en memoria en tests) ---

export interface StaffUserView {
  id: string;
  name: string;
  email: string;
  staffRole: StaffRole;
  permissions: Permissions;
  banned: boolean;
  createdAt: string;
}

export type PortResult = { ok: true; value: StaffUserView } | { ok: false; status: number; error: string };

export interface StaffUsersPort<A> {
  list(actor: A): Promise<{ staff: StaffUserView[]; couriers: CourierView[] }>;
  create(actor: A, input: {
    name: string; email: string; password: string; staffRole: StaffRole; permissions?: Partial<Record<Section, AccessLevel>>;
  }): Promise<PortResult>;
  update(actor: A, id: string, patch: {
    name?: string; staffRole?: StaffRole; permissions?: Partial<Record<Section, AccessLevel>>; banned?: boolean; password?: string;
  }): Promise<PortResult>;
}

export interface ApiResult {
  status: number;
  body: unknown;
}

const ok = (status: number, body: unknown): ApiResult => ({ status, body });
const err = (status: number, error: string): ApiResult => ({ status, body: { error } });
const NOT_OWNER = err(403, "Solo el dueño puede gestionar usuarios.");

function present(u: StaffUserView): StaffUserPublic {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    staff_role: u.staffRole,
    permissions: u.permissions,
    banned: u.banned,
    createdAt: u.createdAt,
  };
}

const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Datos inválidos.";
const fromFailure = (r: Extract<PortResult, { ok: false }>) => err(r.status, r.error);

export async function listStaffUsersApi<A>(
  port: StaffUsersPort<A>, access: StaffAccess, actor: A, currentUserId: string,
): Promise<ApiResult> {
  if (!canManageUsers(access)) return NOT_OWNER;
  const { staff, couriers } = await port.list(actor);
  const body: StaffUsersListing = { users: staff.map(present), couriers, currentUserId };
  return ok(200, body);
}

export async function createStaffUserApi<A>(port: StaffUsersPort<A>, access: StaffAccess, actor: A, rawBody: unknown): Promise<ApiResult> {
  if (!canManageUsers(access)) return NOT_OWNER;
  const parsed = createStaffSchema.safeParse(rawBody);
  if (!parsed.success) return err(400, firstIssue(parsed.error));
  const { staff_role, ...rest } = parsed.data;
  const result = await port.create(actor, { ...rest, staffRole: staff_role });
  return result.ok ? ok(201, { user: present(result.value) }) : fromFailure(result);
}

export async function updateStaffUserApi<A>(
  port: StaffUsersPort<A>, access: StaffAccess, actor: A, id: string, rawBody: unknown,
): Promise<ApiResult> {
  if (!canManageUsers(access)) return NOT_OWNER;
  if (!userIdSchema.safeParse(id).success) return err(400, "Usuario inválido.");
  const parsed = updateStaffSchema.safeParse(rawBody);
  if (!parsed.success) return err(400, firstIssue(parsed.error));
  const { staff_role, ...rest } = parsed.data;
  const result = await port.update(actor, id, { ...rest, ...(staff_role !== undefined ? { staffRole: staff_role } : {}) });
  return result.ok ? ok(200, { user: present(result.value) }) : fromFailure(result);
}
