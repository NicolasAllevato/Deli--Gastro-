/**
 * Lógica de /api/admin/eliminar-datos (solo el dueño principal) y /api/account/delete (la propia cuenta del personal), separada de las
 * rutas para probarla sin Next. La ruta autentica (sesión, CSRF, límite) y entrega acá quién llama; este módulo valida los datos con
 * zod, exige las condiciones de cada herramienta y traduce los resultados de la capa de datos a HTTP. Errores en español.
 */
import { z } from "zod";
import { BRAND } from "../brand.ts";
import {
  DELETION_CONFIRM_WORD, DELETION_MAX_PASSWORD,
  type DeletionAdminListing, type DeletionEligibilityView, type DeletionPreviewView, type DeletionRequestRowView, type DeletionResultView, type StaffUserView,
} from "./types.ts";

export { DELETION_CONFIRM_WORD, DELETION_MAX_PASSWORD };

const ONLY_SUPER_OWNER = "Solo el dueño principal puede eliminar usuarios.";
const NOT_STAFF = `Solo el personal del local elimina su cuenta desde la aplicación. Los clientes piden la baja por email a ${BRAND.contactEmail}.`;

// --- Validación -----------------------------------------------------------------------------------------

/** Ids de Better Auth: uuid (los de esta app) o cadenas alfanuméricas propias de la librería. */
export const userIdSchema = z.string({ error: "Elegí un usuario." }).min(1, "Elegí un usuario.").max(64).regex(/^[A-Za-z0-9_-]+$/, "Usuario inválido.");

const emailSchema = z.email({ error: "Email inválido." }).max(254, "Email inválido.");

/** Búsqueda por email EXACTO (sin parciales). */
export const listQuerySchema = z.strictObject({ email: emailSchema.optional() });

export const previewBodySchema = z.strictObject({ userId: userIdSchema });

export const executeBodySchema = z.strictObject({
  userId: userIdSchema,
  /** El código de un solo uso que devolvió la vista previa. */
  token: z.string({ error: "Falta el código de confirmación." }).min(1, "Falta el código de confirmación.").max(512, "Código inválido."),
  /** La contraseña del dueño principal. */
  password: z.string({ error: "Ingresá tu contraseña." }).min(1, "Ingresá tu contraseña.").max(DELETION_MAX_PASSWORD, "La contraseña es demasiado larga."),
  /** El email exacto del usuario a eliminar. */
  confirmEmail: z.string({ error: "Escribí el email del usuario." }).trim().min(1, "Escribí el email del usuario.").max(254, "Email inválido."),
});

export const deleteOwnBodySchema = z.strictObject({
  password: z.string({ error: "Ingresá tu contraseña actual." }).min(1, "Ingresá tu contraseña actual.").max(DELETION_MAX_PASSWORD, "La contraseña es demasiado larga."),
  confirm: z.literal(DELETION_CONFIRM_WORD, { error: `Escribí ${DELETION_CONFIRM_WORD} para confirmar.` }),
});

const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Datos inválidos.";

// --- Puerto hacia la capa de datos --------------------------------------------------------------------------

export type PortOutcome<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
export type Notifier = (email: string) => Promise<void>;

export interface DeletionPort<A> {
  users(actor: A, exactEmail?: string): Promise<PortOutcome<StaffUserView[]>>;
  recent(actor: A): Promise<DeletionRequestRowView[]>;
  preview(actor: A, userId: string): Promise<PortOutcome<DeletionPreviewView>>;
  execute(actor: A, input: { userId: string; token: string; password: string; confirmEmail: string }, notify?: Notifier): Promise<PortOutcome<DeletionResultView>>;
  eligibility(userId: string): Promise<{ canDelete: true } | { canDelete: false; status: number; reason: string }>;
  deleteOwn(userId: string, password: string, notify?: Notifier): Promise<PortOutcome<DeletionResultView>>;
}

export interface ApiResult {
  status: number;
  body: unknown;
}

const ok = (status: number, body: unknown): ApiResult => ({ status, body });
const err = (status: number, error: string): ApiResult => ({ status, body: { error } });
const isForbidden = (e: unknown) => e instanceof Error && e.name === "ForbiddenError";

/** Quién llama a la herramienta del panel, ya resuelto por la ruta. */
export interface SuperOwnerContext {
  isSuperOwner: boolean;
}

/** Corre la operación de la herramienta: solo el dueño principal; la capa de datos lo vuelve a verificar contra la base. */
async function asSuperOwner(ctx: SuperOwnerContext, run: () => Promise<ApiResult>): Promise<ApiResult> {
  if (!ctx.isSuperOwner) return err(403, ONLY_SUPER_OWNER);
  try {
    return await run();
  } catch (e: unknown) {
    if (isForbidden(e)) return err(403, ONLY_SUPER_OWNER);
    throw e;
  }
}

// --- Herramienta del dueño principal --------------------------------------------------------------------------

/** GET: el personal que se puede elegir (o el del email exacto) y los pedidos recientes. */
export function listApi<A>(port: DeletionPort<A>, ctx: SuperOwnerContext, actor: A, query: { email?: string }): Promise<ApiResult> {
  return asSuperOwner(ctx, async () => {
    const parsed = listQuerySchema.safeParse(query);
    if (!parsed.success) return err(400, firstIssue(parsed.error));
    const users = await port.users(actor, parsed.data.email);
    if (!users.ok) return err(users.status, users.error);
    const body: DeletionAdminListing = { users: users.value, recent: await port.recent(actor) };
    return ok(200, body);
  });
}

/** POST vista previa: nombre, email, rol, qué se borra y qué se conserva, más el código de un solo uso para ejecutar. */
export function previewApi<A>(port: DeletionPort<A>, ctx: SuperOwnerContext, actor: A, rawBody: unknown): Promise<ApiResult> {
  return asSuperOwner(ctx, async () => {
    const parsed = previewBodySchema.safeParse(rawBody);
    if (!parsed.success) return err(400, firstIssue(parsed.error));
    const preview = await port.preview(actor, parsed.data.userId);
    return preview.ok ? ok(200, { preview: preview.value }) : err(preview.status, preview.error);
  });
}

/** POST ejecución: exige el código de la vista previa, la contraseña del dueño y el email exacto del usuario. */
export function executeApi<A>(port: DeletionPort<A>, ctx: SuperOwnerContext, actor: A, rawBody: unknown, notify?: Notifier): Promise<ApiResult> {
  return asSuperOwner(ctx, async () => {
    const parsed = executeBodySchema.safeParse(rawBody);
    if (!parsed.success) return err(400, firstIssue(parsed.error));
    const result = await port.execute(actor, parsed.data, notify);
    return result.ok ? ok(200, { result: result.value }) : err(result.status, result.error);
  });
}

// --- La propia cuenta (solo personal) -------------------------------------------------------------------------

export interface SelfContext {
  userId: string;
  /** Rol de la sesión: admin = personal del local; cliente y repartidor no pueden eliminar su cuenta desde la aplicación. */
  role: string;
}

export async function eligibilityApi<A>(port: DeletionPort<A>, ctx: SelfContext): Promise<ApiResult> {
  if (ctx.role !== "admin") return err(403, NOT_STAFF);
  const e = await port.eligibility(ctx.userId);
  const body: DeletionEligibilityView = e.canDelete ? { canDelete: true, reason: null } : { canDelete: false, reason: e.reason };
  return ok(200, body);
}

export async function deleteOwnApi<A>(port: DeletionPort<A>, ctx: SelfContext, rawBody: unknown, notify?: Notifier): Promise<ApiResult> {
  if (ctx.role !== "admin") return err(403, NOT_STAFF);
  const parsed = deleteOwnBodySchema.safeParse(rawBody);
  if (!parsed.success) return err(400, firstIssue(parsed.error));
  const result = await port.deleteOwn(ctx.userId, parsed.data.password, notify);
  return result.ok ? ok(200, { ok: true }) : err(result.status, result.error);
}

// --- Cookies de sesión ---------------------------------------------------------------------------------------------

/** Cookies de Better Auth (prefijo `opsyn`, con o sin `__Secure-`, ver AUTH_COOKIE_PREFIX en data/auth.ts). */
const AUTH_COOKIE = /^(?:__Secure-)?opsyn\./;

/** De las cookies del pedido, las de sesión que hay que vencer al eliminar la cuenta. */
export function authCookiesToExpire(names: readonly string[]): string[] {
  return names.filter((n) => AUTH_COOKIE.test(n));
}
