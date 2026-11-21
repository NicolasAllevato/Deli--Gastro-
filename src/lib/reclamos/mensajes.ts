/** Textos que recibe el cliente desde el panel de reclamos (puros, testeables). */

/** WhatsApp solo deja escribir texto libre durante las 24 h posteriores al último mensaje del cliente. */
export const WINDOW_MS = 24 * 60 * 60 * 1000;

export function dentroDeVentana(lastInboundAt: string | null, now: Date = new Date()): boolean {
  if (!lastInboundAt) return false;
  const t = new Date(lastInboundAt).getTime();
  return Number.isFinite(t) && now.getTime() - t <= WINDOW_MS;
}

export interface Compensacion {
  tipo: "puntos" | "descuento";
  valor: number;
}

/**
 * "Tu reclamo #N quedó resuelto: … " con la compensación, si hubo. Una consulta (`consulta = true`) lleva la respuesta
 * sin hablar de reclamo, número ni compensación.
 */
export function mensajeResolucion(numero: number, resolucion: string, compensacion: Compensacion | null | undefined, consulta = false): string {
  if (consulta) return `Sobre tu consulta: ${resolucion.trim()}\nGracias por escribirnos 🙏`;
  const base = `Tu reclamo #${numero} quedó resuelto: ${resolucion.trim()}`;
  if (!compensacion) return `${base}\nGracias por avisarnos 🙏`;
  const extra =
    compensacion.tipo === "puntos"
      ? `Te sumamos ${compensacion.valor} puntos a tu cuenta 🎁`
      : `Tenés un ${compensacion.valor}% de descuento en tu próximo pedido 🎁 (avisanos al pedir).`;
  return `${base}\n${extra}\nGracias por avisarnos 🙏`;
}
