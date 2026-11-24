/**
 * Lógica de /api/admin/saldo (testeable sin Next): valida con zod y traduce la capa de datos a HTTP.
 * La ruta ya autenticó (sesión, CSRF, límite) y exigió que sea el dueño; acá solo se vuelve a exigir actor admin.
 */
import { z } from "zod";
import type { Actor, AdjustmentInput, AdjustmentResult, CreditClient, CreditConfig, CreditHistory } from "@/lib/data";
import { AdjustmentError, MAX_AJUSTE_CENTS, MAX_TOPE_CENTS, MAX_VENCIMIENTO_DIAS } from "@/lib/data";

export interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

export interface CreditAdminDeps {
  config(actor: Actor): Promise<CreditConfig>;
  setConfig(actor: Actor, config: CreditConfig): Promise<CreditConfig>;
  search(actor: Actor, query: string): Promise<CreditClient[]>;
  history(actor: Actor, clientId: string): Promise<CreditHistory | null>;
  adjust(actor: Actor, input: AdjustmentInput): Promise<AdjustmentResult>;
}

const forbidden = (): ApiResult => ({ status: 403, body: { error: "Solo el dueño puede administrar el saldo a favor." } });
const isAdmin = (actor: Actor) => actor.kind === "admin";
const clientIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Cliente inválido.");

/** Pesos con hasta 2 decimales → centavos enteros. */
const pesos = (max: number, label: string) =>
  z
    .number({ error: `${label} inválido.` })
    .min(0, `${label} no puede ser negativo.`)
    .max(max / 100, `${label} demasiado alto.`)
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, `${label}: máximo 2 decimales.`)
    .transform((n) => Math.round(n * 100));

export const configSchema = z.strictObject({
  topePesos: pesos(MAX_TOPE_CENTS, "Tope"),
  vencimientoDias: z.number({ error: "Vencimiento inválido." }).int("Los días deben ser un número entero.").min(0, "Los días no pueden ser negativos.").max(MAX_VENCIMIENTO_DIAS, "Vencimiento demasiado largo."),
});

export const adjustSchema = z.strictObject({
  clientId: clientIdSchema,
  tipo: z.enum(["sumar", "restar"], { error: "Elegí si sumar o restar." }),
  pesos: pesos(MAX_AJUSTE_CENTS, "Monto").refine((c) => c > 0, "El monto debe ser mayor a 0."),
  motivo: z.string({ error: "El motivo es obligatorio." }).trim().min(3, "Escribí un motivo (mínimo 3 caracteres).").max(200, "El motivo es muy largo (máximo 200)."),
  idempotencyKey: z.string({ error: "Falta el identificador de la operación." }).uuid("Identificador de operación inválido."),
});

function fail(err: unknown, op: string): ApiResult {
  if (err instanceof AdjustmentError) return { status: err.kind === "cliente" ? 404 : err.kind === "saldo" ? 409 : 400, body: { error: err.message } };
  console.error(`[admin/saldo] ${op}`, err instanceof Error ? err.message : err);
  return { status: 500, body: { error: "No se pudo completar la operación." } };
}

const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Datos inválidos.";

/** GET: configuración + clientes (búsqueda `q`, o los que tienen saldo). Con `cliente`: su historial. */
export async function readSaldo(actor: Actor, params: URLSearchParams, deps: CreditAdminDeps): Promise<ApiResult> {
  if (!isAdmin(actor)) return forbidden();
  try {
    const clienteRaw = params.get("cliente");
    if (clienteRaw) {
      const id = clientIdSchema.safeParse(clienteRaw);
      if (!id.success) return { status: 400, body: { error: firstIssue(id.error) } };
      const history = await deps.history(actor, id.data);
      return history ? { status: 200, body: { ...history } } : { status: 404, body: { error: "No se encontró el cliente." } };
    }
    const q = (params.get("q") ?? "").slice(0, 80);
    const [config, clients] = await Promise.all([deps.config(actor), deps.search(actor, q)]);
    return { status: 200, body: { config, clients } };
  } catch (err) {
    return fail(err, "read");
  }
}

export async function saveConfig(actor: Actor, body: unknown, deps: CreditAdminDeps): Promise<ApiResult> {
  if (!isAdmin(actor)) return forbidden();
  const parsed = configSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: firstIssue(parsed.error) } };
  try {
    const config = await deps.setConfig(actor, { topeCents: parsed.data.topePesos, vencimientoDias: parsed.data.vencimientoDias });
    return { status: 200, body: { ok: true, config } };
  } catch (err) {
    return fail(err, "config");
  }
}

export async function adjustSaldo(actor: Actor, adminLabel: string, body: unknown, deps: CreditAdminDeps): Promise<ApiResult> {
  if (!isAdmin(actor)) return forbidden();
  const parsed = adjustSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: firstIssue(parsed.error) } };
  const { clientId, tipo, pesos: cents, motivo, idempotencyKey } = parsed.data;
  try {
    const r = await deps.adjust(actor, { clientId, deltaCents: tipo === "sumar" ? cents : -cents, reason: motivo, idempotencyKey, adminLabel });
    return { status: 200, body: { ok: true, applied: r.applied, balanceCents: r.balanceCents } };
  } catch (err) {
    return fail(err, "ajuste");
  }
}
