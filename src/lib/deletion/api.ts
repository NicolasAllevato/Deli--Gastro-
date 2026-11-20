/**
 * Lógica de /api/admin/eliminar-datos (solo el dueño principal) y /api/account/delete (la propia cuenta), separada de las rutas
 * para probarla sin Next. La ruta autentica (sesión, CSRF, límite) y entrega acá quién llama; este módulo valida los datos con
 * zod, exige las condiciones de cada herramienta y traduce los resultados de la capa de datos a HTTP. Errores en español.
 */
import { z } from "zod";
import {
  DELETION_CONFIRM_WORD, DELETION_MAX_PASSWORD,
  type DeletionAdminListing, type DeletionEligibilityView, type DeletionPreviewView, type DeletionRequestRowView, type DeletionResultView,
} from "./types.ts";

export { DELETION_CONFIRM_WORD, DELETION_MAX_PASSWORD };

const ONLY_SUPER_OWNER = "Solo el dueño principal puede eliminar datos personales.";
const COURIER = "Los repartidores no pueden eliminar su cuenta desde acá. Pedíselo al local.";
const FILES_NOTE = "No se pudieron borrar algunos archivos de fotos; quedaron anotados en el registro.";

// --- Validación -----------------------------------------------------------------------------------------

const phoneSchema = z
  .string({ error: "Indicá un teléfono." })
  .trim()
  .regex(/^[0-9+()\s.-]{8,32}$/, "El teléfono tiene que tener solo números, espacios, + o guiones.")
  .refine((v) => {
    const digits = v.replace(/\D/g, "").length;
    return digits >= 8 && digits <= 15;
  }, "El teléfono tiene que tener entre 8 y 15 dígitos.");

const emailSchema = z.email({ error: "Email inválido." }).max(254, "Email inválido.");

/** Exactamente uno de los dos (teléfono o email): así se sabe de qué persona se habla sin ambigüedad. */
const exactlyOne = (v: { phone?: string; email?: string }) => (v.phone === undefined) !== (v.email === undefined);
const ONE_MESSAGE = "Indicá un teléfono o un email (uno solo).";

export const previewQuerySchema = z
  .strictObject({ phone: phoneSchema.optional(), email: emailSchema.optional() })
  .refine(exactlyOne, { message: ONE_MESSAGE });

export const executeBodySchema = z
  .strictObject({
    phone: phoneSchema.optional(),
    email: emailSchema.optional(),
    /** De dónde llegó el pedido: por email (lo habitual) o iniciado desde el panel. */
    channel: z.enum(["email", "admin"], { error: "Canal inválido." }).default("email"),
    confirm: z.literal(DELETION_CONFIRM_WORD, { error: `Escribí ${DELETION_CONFIRM_WORD} para confirmar.` }),
  })
  .refine(exactlyOne, { message: ONE_MESSAGE });

export const deleteOwnBodySchema = z.strictObject({
  password: z
    .string({ error: "Ingresá tu contraseña actual." })
    .min(1, "Ingresá tu contraseña actual.")
    .max(DELETION_MAX_PASSWORD, "La contraseña es demasiado larga."),
  confirm: z.literal(DELETION_CONFIRM_WORD, { error: `Escribí ${DELETION_CONFIRM_WORD} para confirmar.` }),
});

const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Datos inválidos.";

// --- Puerto hacia la capa de datos --------------------------------------------------------------------------

export type PortFailure = { ok: false; status: number; error: string };
export type PortOutcome<T> = { ok: true; value: T } | PortFailure;

/** Un archivo borrable: lo inyecta la ruta (R2 no vive en la capa de datos). */
export interface PortFiles {
  delete(keys: string[]): Promise<void>;
}

export interface DeletionPort<A> {
  preview(actor: A, subject: { phone?: string; email?: string }): Promise<PortOutcome<DeletionPreviewView>>;
  execute(actor: A, input: { phone?: string; email?: string; channel: "admin" | "email" }, files?: PortFiles | null): Promise<PortOutcome<DeletionResultView>>;
  recent(actor: A): Promise<DeletionRequestRowView[]>;
  eligibility(userId: string): Promise<{ canDelete: true } | { canDelete: false; status: number; reason: string }>;
  deleteOwn(userId: string, password: string, files?: PortFiles | null): Promise<PortOutcome<DeletionResultView>>;
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

// --- Herramienta del dueño principal --------------------------------------------------------------------------

export async function previewApi<A>(
  port: DeletionPort<A>, ctx: SuperOwnerContext, actor: A, query: Record<string, string | undefined>,
): Promise<ApiResult> {
  if (!ctx.isSuperOwner) return err(403, ONLY_SUPER_OWNER);
  const hasQuery = query.phone !== undefined || query.email !== undefined;
  try {
    if (!hasQuery) {
      const listing: DeletionAdminListing = { preview: null, recent: await port.recent(actor) };
      return ok(200, listing);
    }
    const parsed = previewQuerySchema.safeParse({ phone: query.phone, email: query.email });
    if (!parsed.success) return err(400, firstIssue(parsed.error));
    const preview = await port.preview(actor, parsed.data);
    if (!preview.ok) return err(preview.status, preview.error);
    const listing: DeletionAdminListing = { preview: preview.value, recent: await port.recent(actor) };
    return ok(200, listing);
  } catch (e: unknown) {
    if (isForbidden(e)) return err(403, ONLY_SUPER_OWNER);
    throw e;
  }
}

export async function executeApi<A>(
  port: DeletionPort<A>, ctx: SuperOwnerContext, actor: A, rawBody: unknown, files?: PortFiles | null,
): Promise<ApiResult> {
  if (!ctx.isSuperOwner) return err(403, ONLY_SUPER_OWNER);
  const parsed = executeBodySchema.safeParse(rawBody);
  if (!parsed.success) return err(400, firstIssue(parsed.error));
  try {
    const result = await port.execute(actor, parsed.data, files);
    if (!result.ok) return err(result.status, result.error);
    return ok(200, { result: result.value, note: result.value.status === "partial" ? FILES_NOTE : null });
  } catch (e: unknown) {
    if (isForbidden(e)) return err(403, ONLY_SUPER_OWNER);
    throw e;
  }
}

// --- La propia cuenta --------------------------------------------------------------------------------------------

export interface SelfContext {
  userId: string;
  /** Rol de la sesión: cliente, admin (personal del local) o repartidor. */
  role: string;
}

export async function eligibilityApi<A>(port: DeletionPort<A>, ctx: SelfContext): Promise<ApiResult> {
  if (ctx.role === "repartidor") {
    const body: DeletionEligibilityView = { canDelete: false, reason: COURIER };
    return ok(200, body);
  }
  const e = await port.eligibility(ctx.userId);
  const body: DeletionEligibilityView = e.canDelete ? { canDelete: true, reason: null } : { canDelete: false, reason: e.reason };
  return ok(200, body);
}

export async function deleteOwnApi<A>(
  port: DeletionPort<A>, ctx: SelfContext, rawBody: unknown, files?: PortFiles | null,
): Promise<ApiResult> {
  if (ctx.role === "repartidor") return err(403, COURIER);
  if (ctx.role !== "cliente" && ctx.role !== "admin") return err(403, "No tenés permiso para esta acción.");
  const parsed = deleteOwnBodySchema.safeParse(rawBody);
  if (!parsed.success) return err(400, firstIssue(parsed.error));
  const result = await port.deleteOwn(ctx.userId, parsed.data.password, files);
  if (!result.ok) return err(result.status, result.error);
  return ok(200, { ok: true });
}

// --- Cookies de sesión ---------------------------------------------------------------------------------------------

/** Cookies de Better Auth (prefijo `opsyn`, con o sin `__Secure-`, ver AUTH_COOKIE_PREFIX en data/auth.ts). */
const AUTH_COOKIE = /^(?:__Secure-)?opsyn\./;

/** De las cookies del pedido, las de sesión que hay que vencer al eliminar la cuenta. */
export function authCookiesToExpire(names: readonly string[]): string[] {
  return names.filter((n) => AUTH_COOKIE.test(n));
}
