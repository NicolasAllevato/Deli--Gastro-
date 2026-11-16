/**
 * Escenarios del simulador de clientes: tipo, persona y objetivo. Determinista (mismo n → mismos escenarios)
 * para poder comparar corridas. Los errores aprobados (regresión) van primero.
 */
export const SCENARIO_TYPES = ["pedido_cambios", "cancelacion", "queja_reclamo", "jerga_errores"] as const;
export type ScenarioType = (typeof SCENARIO_TYPES)[number];

export interface Scenario {
  id: string;
  type: ScenarioType | "regresion";
  persona: string;
  goal: string;
  /** Qué tiene que hacer el bot para que cuente como resuelto. */
  expected: string;
  /** El bot debe derivar a una persona (quejas y reclamos). */
  mustHandoff: boolean;
  /** Primer mensaje fijo (regresión: el mensaje que falló); si no, lo inventa el cliente simulado. */
  opener?: string;
  /** Id del error aprobado que repite (solo regresión). */
  errorId?: string;
  maxTurns: number;
}

export interface RegressionCase {
  id: string;
  escenario: string;
  mensaje_cliente: string;
  motivo: string;
  correccion: string;
  tipo: string;
}

const PERSONAS = [
  "Laura, 34, escribe rápido, amable, usa emojis",
  "Don Carlos, 68, escribe todo en mayúsculas y con faltas, poco paciente",
  "Juli, 22, habla en jerga porteña, abrevia todo (q, xq, tmb, dsp)",
  "Marcela, 45, educada pero exigente, da muchos detalles",
  "Nico, 29, manda mensajes cortos de a uno y cambia de idea",
];

const VARIANTS: Record<ScenarioType, { goal: string; expected: string; mustHandoff: boolean }[]> = {
  pedido_cambios: [
    { goal: "Pedí 2 pizzas para delivery; después cambiá una por otra y corregí la dirección.", expected: "Cotiza con quote_order y re-cotiza tras cada cambio; manda el resumen y el link de pago al confirmar.", mustHandoff: false },
    { goal: "Empezá a pedir empanadas, en el medio preguntá si hacen envío a tu zona y el horario, y después terminá el pedido.", expected: "Responde la consulta del local sin perder el pedido y lo termina cotizando.", mustHandoff: false },
    { goal: "Pedí una promo que viste en Instagram; si no existe, elegí otra cosa del menú.", expected: "No inventa promos ni precios; ofrece lo del menú y cotiza.", mustHandoff: false },
  ],
  cancelacion: [
    { goal: "Hacé un pedido y, antes de confirmar el pago, decí que mejor no, que lo cancelás.", expected: "Pregunta si confirma la cancelación y cancela con cancel_order solo tras el SÍ.", mustHandoff: false },
    { goal: "Decí que ya pagaste un pedido hace 10 minutos y que lo querés cancelar porque te equivocaste de dirección.", expected: "Consulta el estado del pedido y explica qué se puede hacer o deriva a una persona sin prometer reembolsos.", mustHandoff: false },
  ],
  queja_reclamo: [
    { goal: "Quejate: tu pedido tarda 1 hora y media y nadie te avisa. Estás enojado.", expected: "Empatiza, no discute, y deriva a una persona del local (handoff).", mustHandoff: true },
    { goal: "Reclamá que la pizza llegó fría y faltaba una bebida. Pedí que te devuelvan la plata.", expected: "Empatiza, no promete reembolsos y deriva a una persona.", mustHandoff: true },
    { goal: "Reclamá que te cobraron de más en Mercado Pago.", expected: "No pide datos de tarjeta, no inventa montos y deriva a una persona.", mustHandoff: true },
  ],
  jerga_errores: [
    { goal: "Pedí usando apodos: 'la napo', 'una muzza grande', 'dos de carne cortada a cuchillo', 'una coca de 1 y medio'. Escribí con faltas.", expected: "Entiende los apodos o pregunta para aclarar; no inventa productos.", mustHandoff: false },
    { goal: "Escribí como si fuera un audio transcripto, desordenado: '[audio] eh hola si quería saber si tienen eh la de jamón y morrón y cuánto sale el envío a palermo'.", expected: "Interpreta el audio y responde con datos de las herramientas.", mustHandoff: false },
    { goal: "Mandá abreviaturas y errores: 'ola tenes algo sin tacc? y xq tarda tanto el delivery los findes'.", expected: "Responde lo que sabe por la base de conocimiento; si no sabe, lo dice sin inventar.", mustHandoff: false },
  ],
};

/** Genera `n` escenarios: primero los de regresión (hasta `n`), después rota tipos, variantes y personas. */
export function generateScenarios(n: number, regressions: readonly RegressionCase[] = []): Scenario[] {
  const count = Math.max(0, Math.floor(n));
  const out: Scenario[] = regressions.slice(0, count).map((r, i) => ({
    id: `reg-${i + 1}`,
    type: "regresion",
    persona: PERSONAS[i % PERSONAS.length],
    goal: `Repetí este caso que antes falló (${r.escenario}). Empezá exactamente con el mensaje dado y seguí la charla con naturalidad.`,
    expected: `Evitar el error anterior: ${r.motivo}. Comportamiento esperado: ${r.correccion}`,
    mustHandoff: r.tipo === "no_derivo",
    opener: r.mensaje_cliente,
    errorId: r.id,
    maxTurns: 4,
  }));
  for (let i = 0; out.length < count; i++) {
    const type = SCENARIO_TYPES[i % SCENARIO_TYPES.length];
    const round = Math.floor(i / SCENARIO_TYPES.length);
    const variant = VARIANTS[type][round % VARIANTS[type].length];
    out.push({
      id: `${type}-${round + 1}`,
      type,
      persona: PERSONAS[(i + round) % PERSONAS.length],
      ...variant,
      maxTurns: type === "queja_reclamo" ? 4 : 6,
    });
  }
  return out;
}
