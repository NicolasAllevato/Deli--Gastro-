import { NextResponse } from "next/server";

/**
 * Resultado de una escritura del catálogo, igual para Supabase y D1, para que
 * `dualWrite` pueda devolver cualquiera de los dos según DATA_BACKEND.
 */
export interface Outcome {
  status: number;
  body: unknown;
}

export const isSuccess = (o: Outcome): boolean => o.status >= 200 && o.status < 300;

export function respond(outcome: Outcome | undefined): NextResponse {
  if (!outcome) return NextResponse.json({ error: "Error interno." }, { status: 500 });
  return NextResponse.json(outcome.body, { status: outcome.status });
}

/** Nunca se devuelve el mensaje crudo de la base al navegador: queda en el log del servidor. */
export function serverError(op: string, err: unknown): NextResponse {
  console.error(`[catalog] ${op}`, err instanceof Error ? err.message : err);
  return NextResponse.json({ error: "Error interno." }, { status: 500 });
}
