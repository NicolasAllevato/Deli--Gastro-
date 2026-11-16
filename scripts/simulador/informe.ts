/** Informe Markdown de una corrida del simulador. Puro: recibe resultados, devuelve texto. */
import type { ErrorInput, SugerenciaInput } from "../../src/lib/data/kb-aprendizaje.ts";
import type { Scenario } from "./escenarios.ts";
import type { TranscriptLine, Verdict } from "./juez.ts";
import { dedupeFailures, dedupeSuggestions } from "./juez.ts";

export interface ConversationResult {
  scenario: Scenario;
  transcript: TranscriptLine[];
  verdict: Verdict | null;
  error?: string;
  /** Lo que logueó el bot (deps.log) en esta conversación. */
  logs?: string[];
}

export interface RunSummary {
  requested: number;
  results: ConversationResult[];
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  limitUsd: number;
  stoppedByBudget: boolean;
  dateIso: string;
}

const pct = (a: number, b: number): string => (b === 0 ? "-" : `${Math.round((a / b) * 100)} %`);
const cell = (s: string): string => s.replace(/\|/g, "/").replace(/\s+/g, " ").slice(0, 160);

export function successByType(results: readonly ConversationResult[]): Array<{ type: string; total: number; ok: number }> {
  const map = new Map<string, { total: number; ok: number }>();
  // Solo conversaciones válidas: las afectadas por el entorno simulado no miden al bot.
  for (const r of results.filter((x) => x.verdict && !x.verdict.entorno)) {
    const row = map.get(r.scenario.type) ?? { total: 0, ok: 0 };
    map.set(r.scenario.type, { total: row.total + 1, ok: row.ok + (r.verdict?.exito ? 1 : 0) });
  }
  return [...map.entries()].map(([type, v]) => ({ type, ...v }));
}

export function renderReport(s: RunSummary): string {
  const judged = s.results.filter((r) => r.verdict && !r.verdict.entorno);
  const ok = judged.filter((r) => r.verdict?.exito).length;
  const affected = s.results.filter((r) => r.verdict?.entorno);
  const failures: ErrorInput[] = judged.flatMap((r) => r.verdict?.fallas ?? []);
  const suggestions: SugerenciaInput[] = judged.flatMap((r) => r.verdict?.sugerencias ?? []);
  const unknownWords = [...new Set(judged.flatMap((r) => r.verdict?.noEntendidas ?? []))];
  const empathy = judged.length ? judged.reduce((sum, r) => sum + (r.verdict?.empatia ?? 0), 0) / judged.length : 0;
  const regressions = s.results.filter((r) => r.scenario.type === "regresion");

  const lines = [
    `# Simulación de clientes del bot — ${s.dateIso.slice(0, 16).replace("T", " ")}`,
    "",
    `- Conversaciones: ${s.results.length} de ${s.requested}${s.stoppedByBudget ? " (cortó por presupuesto)" : ""}`,
    `- Éxito general: ${ok}/${judged.length} (${pct(ok, judged.length)})`,
    `- Empatía promedio: ${empathy.toFixed(1)} / 5`,
    `- Costo: US$ ${s.costUsd.toFixed(3)} de US$ ${s.limitUsd} · tokens: ${s.inputTokens} entrada, ${s.outputTokens} salida`,
    `- Afectadas por el entorno simulado (no cuentan ni se aprenden): ${affected.length}`,
    `- Sin juzgar (error del simulador o del juez): ${s.results.filter((r) => !r.verdict).length}`,
    "",
    "## Éxito por escenario",
    "",
    "| Escenario | Éxito | Total |",
    "|---|---|---|",
    ...successByType(s.results).map((r) => `| ${r.type} | ${pct(r.ok, r.total)} | ${r.total} |`),
    "",
  ];

  if (regressions.length) {
    lines.push("## Regresión (errores aprobados)", "", "| Caso | Resultado |", "|---|---|");
    for (const r of regressions) {
      lines.push(`| ${cell(r.scenario.opener ?? r.scenario.id)} | ${r.verdict?.exito ? "ya no falla" : r.verdict ? "sigue fallando" : "sin juzgar"} |`);
    }
    lines.push("");
  }

  lines.push("## Fallas típicas", "", "| Veces | Tipo | Corrección propuesta | Ejemplo del cliente |", "|---|---|---|---|");
  for (const f of dedupeFailures(failures).slice(0, 25)) {
    lines.push(`| ${f.veces} | ${f.tipo} | ${cell(f.correccion)} | ${cell(f.mensaje_cliente)} |`);
  }
  lines.push("", "## Sugerencias de conocimiento (pendientes de aprobación)", "", "| Veces | Categoría | Tema | Contenido |", "|---|---|---|---|");
  for (const sg of dedupeSuggestions(suggestions).slice(0, 40)) {
    lines.push(`| ${sg.veces} | ${sg.categoria} | ${cell(sg.tema)} | ${cell(sg.contenido)} |`);
  }
  const withLogs = s.results.filter((r) => r.verdict?.entorno || !r.verdict || (r.logs?.length ?? 0) > 0);
  if (withLogs.length) {
    lines.push("", "## Entorno simulado (revisar el simulador, no el bot)", "");
    for (const r of withLogs) {
      lines.push(`### ${r.scenario.id}${r.error ? ` — ${cell(r.error)}` : ""}`);
      for (const f of r.verdict?.fallasEntorno ?? []) lines.push(`- Falla de entorno: ${cell(f.motivo)}`);
      for (const l of r.logs ?? []) lines.push(`- Log: \`${cell(l)}\``);
    }
  }
  lines.push("", "## Palabras que el bot no entendió", "", unknownWords.length ? unknownWords.map((w) => `- ${w}`).join("\n") : "_Ninguna._", "");
  lines.push(
    "## Qué sigue",
    "",
    "Todo quedó como **pendiente** en /admin/conocimiento → Sugerencias y Errores aprendidos. Nada se activó solo.",
    "Los errores que apruebes se vuelven lecciones del agente y se repiten primero en la próxima corrida.",
    "",
  );
  return lines.join("\n");
}
