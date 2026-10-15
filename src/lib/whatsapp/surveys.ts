import { isOpenNow } from "../agent/hours.ts";

export const SURVEY_MIN_DELAY_MIN = 30;
export const SURVEY_MAX_AGE_MIN = 180;
export const SURVEY_BATCH = 50;
/** Tiempo máximo de una corrida; deja margen bajo el `maxDuration` de 60 s de la ruta. */
export const SURVEY_BUDGET_MS = 40_000;
/** Franja en la que se mandan encuestas (hora de Buenos Aires): nadie las quiere de madrugada. */
export const SURVEY_WINDOW = { from: "09:00", to: "22:00" } as const;

const MINUTE_MS = 60_000;

/** Las operaciones externas de las encuestas, inyectadas para poder probar el flujo sin base ni Meta. */
export interface SurveyDeps<O extends { id: string }, T> {
  listDue(fromIso: string, toIso: string, limit: number): Promise<O[]>;
  reviewedIds(orderIds: string[]): Promise<Set<string>>;
  /** null = el cliente nunca le escribió al local (sin consentimiento para avisos por WhatsApp). */
  loadTarget(order: O): Promise<T | null>;
  /** Marca el pedido como encuestado solo si todavía no lo estaba. false = otra ejecución lo ganó. */
  claim(orderId: string, nowIso: string): Promise<boolean>;
  /** Deshace el claim para que una próxima ejecución reintente. */
  release(orderId: string, nowIso: string): Promise<void>;
  send(order: O, target: T): Promise<boolean>;
}

export interface SurveyResult {
  sent: number;
  skipped: number;
  failed: number;
  outsideWindow: boolean;
}

/**
 * Manda la encuesta a los pedidos entregados hace entre 30 min y 3 h sin reseña ni encuesta.
 * Idempotente ante ejecuciones solapadas: el pedido se reclama ANTES de enviar y se libera
 * si el envío falla, así que se reintenta en la próxima corrida (hasta que vence la ventana).
 */
export async function runSurveys<O extends { id: string }, T>(
  deps: SurveyDeps<O, T>,
  now: Date = new Date(),
): Promise<SurveyResult> {
  const result: SurveyResult = { sent: 0, skipped: 0, failed: 0, outsideWindow: false };
  if (!isOpenNow(SURVEY_WINDOW.from, SURVEY_WINDOW.to, now)) return { ...result, outsideWindow: true };

  const from = new Date(now.getTime() - SURVEY_MAX_AGE_MIN * MINUTE_MS).toISOString();
  const to = new Date(now.getTime() - SURVEY_MIN_DELAY_MIN * MINUTE_MS).toISOString();
  const nowIso = now.toISOString();

  const due = await deps.listDue(from, to, SURVEY_BATCH);
  if (due.length === 0) return result;
  const reviewed = await deps.reviewedIds(due.map((o) => o.id));

  const startedAt = Date.now();
  for (const order of due) {
    // Si la plataforma corta la función entre el reclamo y el envío, el pedido queda reclamado
    // sin encuesta: se frena antes y lo que falta va en la próxima corrida.
    if (Date.now() - startedAt > SURVEY_BUDGET_MS) break;
    if (reviewed.has(order.id)) { result.skipped += 1; continue; }
    try {
      const target = await deps.loadTarget(order);
      if (!target) { result.skipped += 1; continue; }
      if (!(await deps.claim(order.id, nowIso))) { result.skipped += 1; continue; }

      let ok = false;
      try {
        ok = await deps.send(order, target);
      } finally {
        if (!ok) {
          await deps.release(order.id, nowIso).catch((e: unknown) => {
            console.error("[whatsapp] no se pudo liberar la encuesta", order.id, e);
          });
        }
      }
      if (ok) result.sent += 1;
      else result.failed += 1;
    } catch (error: unknown) {
      result.failed += 1;
      console.error("[whatsapp] no se pudo enviar la encuesta", order.id, error);
    }
  }
  return result;
}
