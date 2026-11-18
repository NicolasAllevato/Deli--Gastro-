/**
 * Lógica de las rutas /api/admin/reclamos (testeable sin Next): valida con zod, exige admin y llama a la capa
 * de datos y a los envíos por las dependencias inyectadas.
 */
import { z } from "zod";
import {
  ReclamoConflictoError,
  ReclamoNoEncontradoError,
  reclamoAccionSchema,
  reclamoFiltrosSchema,
  type Actor,
  type ReclamoCategoria,
  type ReclamoDetalle,
  type Reclamo,
  type ReclamosResumen,
} from "@/lib/data";
import { mensajeResolucion } from "./mensajes.ts";
import type { EnvioResultado } from "./server.ts";

export interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

export interface ReclamosApiDeps {
  list(actor: Actor, filtros: z.infer<typeof reclamoFiltrosSchema>): Promise<Reclamo[]>;
  get(actor: Actor, id: string): Promise<ReclamoDetalle | null>;
  porCategoria(actor: Actor, desde: string): Promise<Record<ReclamoCategoria, number>>;
  resumen(actor: Actor): Promise<ReclamosResumen>;
  cambiarEstado(actor: Actor, id: string, accion: "tomar" | "reabrir"): Promise<void>;
  nota(actor: Actor, id: string, texto: string): Promise<void>;
  resolver(
    actor: Actor,
    id: string,
    input: { resolucion: string; compensacion?: { tipo: "puntos" | "descuento"; valor: number } | null },
  ): Promise<{ reclamo: Reclamo; puntosAcreditados: number }>;
  enviar(actor: Actor, id: string, texto: string): Promise<EnvioResultado>;
  now?: () => Date;
}

const idSchema = z.string().uuid();
const forbidden = (): ApiResult => ({ status: 403, body: { error: "Solo el administrador puede ver los reclamos." } });
const isAdmin = (actor: Actor) => actor.kind === "admin";

function errorResult(err: unknown, op: string): ApiResult {
  if (err instanceof ReclamoNoEncontradoError) return { status: 404, body: { error: err.message } };
  if (err instanceof ReclamoConflictoError) return { status: 409, body: { error: err.message } };
  console.error(`[reclamos] ${op}`, err instanceof Error ? err.message : err);
  return { status: 500, body: { error: "No se pudo completar la operación." } };
}

/** GET lista: filtros por query (estado, categoria, desde, hasta) + conteo por categoría de los últimos 30 días. */
export async function listarReclamos(actor: Actor, params: URLSearchParams, deps: ReclamosApiDeps): Promise<ApiResult> {
  if (!isAdmin(actor)) return forbidden();
  const raw = Object.fromEntries([...params.entries()].filter(([, v]) => v !== ""));
  const parsed = reclamoFiltrosSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: parsed.error.issues[0]?.message ?? "Filtros inválidos." } };
  try {
    const desde = new Date((deps.now?.() ?? new Date()).getTime() - 30 * 86_400_000).toISOString();
    const [reclamos, porCategoria] = await Promise.all([deps.list(actor, parsed.data), deps.porCategoria(actor, desde)]);
    return { status: 200, body: { reclamos, porCategoria } };
  } catch (err) {
    return errorResult(err, "list");
  }
}

export async function resumenReclamosApi(actor: Actor, deps: ReclamosApiDeps): Promise<ApiResult> {
  if (!isAdmin(actor)) return forbidden();
  try {
    return { status: 200, body: { ...(await deps.resumen(actor)) } };
  } catch (err) {
    return errorResult(err, "resumen");
  }
}

export async function detalleReclamo(actor: Actor, id: string, deps: ReclamosApiDeps): Promise<ApiResult> {
  if (!isAdmin(actor)) return forbidden();
  if (!idSchema.safeParse(id).success) return { status: 400, body: { error: "Reclamo inválido." } };
  try {
    const reclamo = await deps.get(actor, id);
    return reclamo ? { status: 200, body: { reclamo } } : { status: 404, body: { error: "No se encontró el reclamo." } };
  } catch (err) {
    return errorResult(err, "get");
  }
}

/** POST acción: tomar, reabrir, nota, responder (WhatsApp) o resolver (+ compensación + WhatsApp al cliente). */
export async function accionReclamo(actor: Actor, id: string, body: unknown, deps: ReclamosApiDeps): Promise<ApiResult> {
  if (!isAdmin(actor)) return forbidden();
  if (!idSchema.safeParse(id).success) return { status: 400, body: { error: "Reclamo inválido." } };
  const parsed = reclamoAccionSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: parsed.error.issues[0]?.message ?? "Datos inválidos." } };
  const input = parsed.data;
  try {
    switch (input.accion) {
      case "tomar":
      case "reabrir":
        await deps.cambiarEstado(actor, id, input.accion);
        return { status: 200, body: { ok: true } };
      case "nota":
        await deps.nota(actor, id, input.texto);
        return { status: 200, body: { ok: true } };
      case "responder": {
        const sent = await deps.enviar(actor, id, input.texto);
        return sent.ok ? { status: 200, body: { ok: true } } : { status: sent.status, body: { error: sent.error } };
      }
      case "resolver": {
        const { reclamo, puntosAcreditados } = await deps.resolver(actor, id, { resolucion: input.resolucion, compensacion: input.compensacion ?? null });
        // La resolución ya quedó guardada: si el WhatsApp no sale (ventana vencida, sin conexión) se avisa pero no se deshace.
        const sent = await deps.enviar(actor, id, mensajeResolucion(reclamo.numero, input.resolucion, input.compensacion ?? null));
        return {
          status: 200,
          body: { ok: true, puntosAcreditados, mensajeEnviado: sent.ok, ...(sent.ok ? {} : { aviso: sent.error }) },
        };
      }
    }
  } catch (err) {
    return errorResult(err, input.accion);
  }
}
