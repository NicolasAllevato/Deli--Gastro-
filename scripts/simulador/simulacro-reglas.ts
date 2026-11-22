/**
 * Reglas del simulacro de conversaciones (docs/PLAN_SIMULACRO_20.md): aserciones por paso y reglas duras.
 * Puras y sin red: las prueba tests/simulacro-reglas.test.ts.
 */

export interface Paso {
  /** Lo que escribe el cliente en este turno. */
  dice: string;
  /** Debe aparecer al menos una de estas expresiones en las respuestas del turno. */
  esperaAlguna?: RegExp[];
  /** Ninguna de estas puede aparecer. */
  noDebe?: RegExp[];
  /** El bot tiene que haber pasado la charla a una persona al terminar este turno. */
  deriva?: boolean;
  /** Este turno debe terminar con una confirmación de pedido (`confirm`) en el mundo simulado. */
  confirma?: boolean;
}

export interface ContextoPaso {
  replies: readonly string[];
  handedOff: boolean;
}

/** Reglas que, si se rompen, invalidan el simulacro sin importar el escenario. Devuelve los nombres de las violadas. */
export function reglasDuras(replies: readonly string[]): string[] {
  const texto = replies.join("\n");
  const out: string[] = [];
  if (/Direcci[oó]n:\s*Comuna\s*\d+/i.test(texto)) out.push("direccion_comuna");
  if (/\b(te|le)\s+(vamos a\s+)?(devolv|reembols)/i.test(texto) && !/no (te )?(puedo|podemos|voy a|vamos a)\s+(prometer|asegurar)/i.test(texto)) out.push("promesa_reembolso");
  if (/quote_order|get_menu|get_business_info|get_categoria|system prompt/i.test(texto)) out.push("fuga_interna");
  return out;
}

/** Devuelve `null` si el paso pasó, o el motivo de la falla. */
export function evaluarPaso(paso: Paso, ctx: ContextoPaso): string | null {
  if (ctx.replies.length === 0 && !paso.deriva) return "sin respuesta del bot en este turno";
  const texto = ctx.replies.join("\n");
  const prohibida = paso.noDebe?.find((r) => r.test(texto));
  if (prohibida) return `no debía aparecer ${prohibida}`;
  if (paso.esperaAlguna && !paso.esperaAlguna.some((r) => r.test(texto))) {
    return `esperaba alguna de ${paso.esperaAlguna.map(String).join(" | ")}`;
  }
  if (paso.deriva && !ctx.handedOff) return "esperaba derivar a una persona y no derivó";
  return null;
}
