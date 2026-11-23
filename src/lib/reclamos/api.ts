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
import { ES_CONSULTA_ERROR } from "./agente.ts";
import { esConsulta } from "./categoria.ts";
import { mensajeResolucion } from "./mensajes.ts";
import type { EnvioResultado } from "./server.ts";
import { descuentoASaldoPesos, SIN_PEDIDO_PARA_DESCUENTO } from "./saldo.ts";

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
    input: { resolucion: string; compensacion?: { tipo: "puntos" | "descuento" | "saldo"; valor: number } | null; mensaje?: string },
  ): Promise<{ reclamo: Reclamo; puntosAcreditados: number; saldoAcreditado?: number }>;
  enviar(actor: Actor, id: string, texto: string): Promise<EnvioResultado>;
  /** Guarda si el aviso de resolución al cliente salió o falló (para mostrar "no se pudo notificar" y reintentar). */
  marcarNotificacion(actor: Actor, id: string, ok: boolean, error?: string): Promise<void>;
  /** Corre el agente de reclamos y guarda la sugerencia. */
  sugerir(id: string): Promise<{ ok: true; sugerencia: unknown } | { ok: false; error: string }>;
  /** Modo entrenamiento del bot (aviso en la página). */
  entrenamiento(actor: Actor): Promise<boolean>;
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
    const [reclamos, porCategoria, modoEntrenamiento] = await Promise.all([
      deps.list(actor, parsed.data),
      deps.porCategoria(actor, desde),
      deps.entrenamiento(actor),
    ]);
    return { status: 200, body: { reclamos, porCategoria, modoEntrenamiento } };
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

/** Manda el aviso de resolución y deja registrado si salió. El reclamo queda resuelto igual (no se deshace). */
async function notificar(actor: Actor, id: string, mensaje: string, deps: ReclamosApiDeps): Promise<Record<string, unknown>> {
  const sent = await deps.enviar(actor, id, mensaje);
  await deps.marcarNotificacion(actor, id, sent.ok, sent.ok ? undefined : sent.error);
  return sent.ok ? { mensajeEnviado: true } : { mensajeEnviado: false, aviso: sent.error };
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
      case "sugerir": {
        const exists = await deps.get(actor, id);
        if (!exists) return { status: 404, body: { error: "No se encontró el reclamo." } };
        if (esConsulta(exists)) return { status: 409, body: { error: ES_CONSULTA_ERROR } };
        const r = await deps.sugerir(id);
        return r.ok ? { status: 200, body: { ok: true, sugerencia: r.sugerencia } } : { status: 502, body: { error: r.error } };
      }
      case "resolver": {
        const actual = await deps.get(actor, id);
        if (!actual) return { status: 404, body: { error: "No se encontró el reclamo." } };
        // Una consulta se responde, no se compensa: sin puntos ni descuento, y el aviso armado no habla de reclamo.
        const consulta = esConsulta(actual);
        let compensacion = consulta ? null : (input.compensacion ?? null);
        // El descuento % se convierte en saldo en pesos (sobre el total del pedido asociado) ANTES de armar el aviso.
        if (compensacion?.tipo === "descuento") {
          if (!actual.pedido) return { status: 409, body: { error: SIN_PEDIDO_PARA_DESCUENTO } };
          const pesos = descuentoASaldoPesos(actual.pedido.total_cents, compensacion.valor);
          if (pesos < 1) return { status: 409, body: { error: "El descuento da menos de $1 sobre ese pedido: usá «Saldo a favor» con un monto en pesos." } };
          compensacion = { tipo: "saldo", valor: pesos };
        }
        // El mensaje SIEMPRE sale: el editado por el local o uno armado con la resolución y la compensación.
        const mensaje = input.mensaje ?? mensajeResolucion(actual.numero, input.resolucion, compensacion, consulta);
        const { puntosAcreditados, saldoAcreditado } = await deps.resolver(actor, id, { resolucion: input.resolucion, compensacion, mensaje });
        return { status: 200, body: { ok: true, puntosAcreditados, saldoAcreditado: saldoAcreditado ?? 0, ...(await notificar(actor, id, mensaje, deps)) } };
      }
      case "renotificar": {
        const actual = await deps.get(actor, id);
        if (!actual) return { status: 404, body: { error: "No se encontró el reclamo." } };
        if (actual.estado !== "resuelto" || !actual.mensaje_resolucion) {
          return { status: 409, body: { error: "El reclamo no tiene un aviso de resolución para reenviar." } };
        }
        if (actual.notificacion_estado === "enviado") return { status: 409, body: { error: "El cliente ya fue notificado." } };
        return { status: 200, body: { ok: true, ...(await notificar(actor, id, actual.mensaje_resolucion, deps)) } };
      }
    }
  } catch (err) {
    return errorResult(err, input.accion);
  }
}
