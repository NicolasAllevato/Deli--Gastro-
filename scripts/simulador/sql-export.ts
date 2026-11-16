/**
 * Exporta lo aprendido en una corrida como SQL para cargarlo PENDIENTE en una D1 (local o, con OK, remota):
 *   npx wrangler d1 execute deli-gastro --local --file reports/simulador/pendientes.sql
 * Idempotente: la misma clave suma `veces` y nunca cambia el estado (no aprueba nada).
 */
import { errorKey, sugerenciaKey, type ErrorInput, type SugerenciaInput } from "../../src/lib/data/kb-aprendizaje.ts";

const q = (s: string): string => `'${s.replace(/\s+/g, " ").trim().replace(/'/g, "''")}'`;

export function exportPendingSql(
  failures: ReadonlyArray<ErrorInput & { veces: number }>,
  suggestions: ReadonlyArray<SugerenciaInput & { veces: number }>,
  newId: () => string,
): string {
  const lines = ["-- Generado por el simulador de clientes. Todo entra como 'pendiente'."];
  for (const s of suggestions) {
    lines.push(
      `INSERT INTO kb_sugerencias (id, clave, origen, categoria, tema, contenido, evidencia, veces) VALUES (${q(newId())}, ${q(sugerenciaKey(s))}, 'simulacion', ${q(s.categoria)}, ${q(s.tema.slice(0, 120))}, ${q(s.contenido.slice(0, 1000))}, ${q((s.evidencia ?? "").slice(0, 2000))}, ${s.veces}) ON CONFLICT (clave) DO UPDATE SET veces = veces + excluded.veces;`,
    );
  }
  for (const f of failures) {
    lines.push(
      `INSERT INTO kb_errores (id, clave, escenario, tipo, mensaje_cliente, respuesta_mala, motivo, correccion, veces) VALUES (${q(newId())}, ${q(errorKey(f))}, ${q(f.escenario.slice(0, 60))}, ${q(f.tipo)}, ${q(f.mensaje_cliente.slice(0, 1000))}, ${q((f.respuesta_mala ?? "").slice(0, 1000))}, ${q(f.motivo.slice(0, 500))}, ${q(f.correccion.slice(0, 300))}, ${f.veces}) ON CONFLICT (clave) DO UPDATE SET veces = veces + excluded.veces;`,
    );
  }
  return `${lines.join("\n")}\n`;
}
