/**
 * Simulador de clientes del bot de WhatsApp (solo demo local).
 *   npm run simular:bot -- --n 100 --budget 3 [--db reports/simulador/sim.db] [--regresion aprobados.json] [--concurrencia 4]
 * Usa el processTurn real del bot con SQLite local, pedidos falsos y GPT-4o mini. No toca Meta, Fudo ni la D1 remota.
 * Lo aprendido queda PENDIENTE (base local + reports/simulador/pendientes.sql para cargar en la D1 que corresponda).
 */
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { systemActor } from "../../src/lib/data/actor.ts";
import { recordError, recordSugerencia, regressionCases, setRegressionResult } from "../../src/lib/data/kb-aprendizaje.ts";
import { processTurn, type TurnDeps } from "../../workers/whatsapp-bot/src/bot/turn.ts";
import { d1BotRepo, d1InboundRepo } from "../../workers/whatsapp-bot/src/repo/d1.ts";
import { clientSystem, clientUser, parseClientTurn } from "./cliente.ts";
import { generateScenarios, type RegressionCase, type Scenario } from "./escenarios.ts";
import { renderReport, type ConversationResult } from "./informe.ts";
import { JUDGE_SYSTEM, buildJudgeInput, dedupeFailures, dedupeSuggestions, environmentSignals, parseVerdict, type TranscriptLine } from "./juez.ts";
import { fakeOrders, menuText, openSimDb, seedWorld } from "./mundo.ts";
import { chatJson, openAiRunner, readOpenAiKey } from "./openai.ts";
import { Budget, estimatePerConversation } from "./presupuesto.ts";
import { exportPendingSql } from "./sql-export.ts";

const ROOT = new URL("../../", import.meta.url);
const { values } = parseArgs({
  options: {
    n: { type: "string", default: "100" },
    budget: { type: "string", default: "3" },
    db: { type: "string", default: "reports/simulador/sim.db" },
    regresion: { type: "string" },
    concurrencia: { type: "string", default: "4" },
  },
});

const n = Math.min(500, Math.max(1, Number(values.n) || 100));
const budget = new Budget(Number(values.budget) || 3);
const concurrency = Math.min(8, Math.max(1, Number(values.concurrencia) || 4));
const actor = systemActor("simulador de clientes");

const apiKey = readOpenAiKey([new URL(".env.local", ROOT), new URL("../../../.env.local", ROOT)]);
if (!apiKey) {
  console.error("Falta OPENAI_API_KEY (entorno o .env.local). Cargala con /cargar-secreto OPENAI_API_KEY.");
  process.exit(2);
}
const run = openAiRunner(apiKey, budget);

const db = openSimDb(fileURLToPath(new URL(values.db, ROOT)));
seedWorld(db);
const menu = menuText(db);
const orders = fakeOrders(db);
const repo = d1BotRepo(db);
const inbound = d1InboundRepo(db);

function loadRegressions(): Promise<RegressionCase[]> | RegressionCase[] {
  if (values.regresion) return JSON.parse(readFileSync(values.regresion, "utf8")) as RegressionCase[];
  return regressionCases(db, actor);
}

async function simulate(scenario: Scenario, index: number): Promise<ConversationResult> {
  const phone = `549117${String(index).padStart(7, "0")}`;
  const conversation = await inbound.upsertConversation(phone, scenario.persona.split(",")[0]);
  if (scenario.seedPaidMinutes !== undefined) orders.seedPaid(conversation.id, scenario.seedPaidMinutes);
  const transcript: TranscriptLine[] = [];
  const sent: string[] = [];
  const logs: string[] = [];
  let handedOff = false;
  let seq = 0;
  const deps: TurnDeps = {
    repo,
    run,
    transcribe: async () => null,
    send: async (_phone, text) => {
      sent.push(text);
      return `sim-out-${index}-${++seq}`;
    },
    appUrl: "https://opsyndely.la-gambeta.com",
    orders,
    log: (message, detail) => { logs.push(`${message}${detail === undefined ? "" : ` ${JSON.stringify(detail).slice(0, 300)}`}`); },
  };
  try {
    for (let turn = 0; turn < scenario.maxTurns; turn++) {
      const askClient = async () => parseClientTurn(await chatJson(run, clientSystem(scenario), clientUser(transcript), 200));
      let next = turn === 0 && scenario.opener ? { message: scenario.opener, done: false, parsed: true } : await askClient();
      // Un JSON roto del cliente simulado no corta la charla: se le vuelve a pedir una vez.
      if (next.done && !next.message && !next.parsed) next = await askClient();
      if (next.done) break;
      transcript.push({ role: "cliente", text: next.message });
      const wamid = `sim-in-${index}-${++seq}`;
      await inbound.saveInbound(conversation.id, { wamid, type: "text", body: next.message });
      sent.length = 0;
      await processTurn({ phone, text: next.message, wamids: [wamid], audios: [], receivedAt: Date.now() }, deps);
      for (const text of sent) transcript.push({ role: "bot", text });
      if ((await repo.getConversation(phone))?.humanTakeover) {
        handedOff = true;
        transcript.push({ role: "bot", text: "[el bot derivó la conversación a una persona del local]" });
        break;
      }
    }
    const verdict = parseVerdict(await chatJson(run, JUDGE_SYSTEM, buildJudgeInput(scenario, menu, transcript, logs), 1200), scenario, environmentSignals(logs), { handedOff });
    return { scenario, transcript, verdict, logs, error: verdict ? undefined : "el juez devolvió un JSON inválido" };
  } catch (error: unknown) {
    return { scenario, transcript, verdict: null, logs, error: error instanceof Error ? error.message.slice(0, 200) : "error" };
  }
}

async function main(): Promise<void> {
  const regressions = await loadRegressions();
  const scenarios = generateScenarios(n, regressions);
  const results: ConversationResult[] = [];
  let next = 0;
  let stoppedByBudget = false;

  async function worker(): Promise<void> {
    while (next < scenarios.length) {
      if (!budget.canAfford(estimatePerConversation(budget, results.length))) {
        stoppedByBudget = true;
        return;
      }
      const i = next++;
      const result = await simulate(scenarios[i], i);
      results.push(result);
      process.stdout.write(`\r${results.length}/${scenarios.length} · US$ ${budget.costUsd.toFixed(3)}   `);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  process.stdout.write("\n");

  // Aprendizaje: todo PENDIENTE en la base local; las regresiones actualizan su último resultado.
  for (const r of results) {
    for (const f of r.verdict?.fallas ?? []) await recordError(db, actor, crypto.randomUUID(), f).catch(() => {});
    for (const s of r.verdict?.sugerencias ?? []) await recordSugerencia(db, actor, crypto.randomUUID(), s).catch(() => {});
    if (r.scenario.errorId && r.verdict && !r.verdict.entorno) await setRegressionResult(db, actor, r.scenario.errorId, r.verdict.exito);
  }

  const dateIso = new Date().toISOString();
  const outDir = new URL("reports/simulador/", ROOT);
  mkdirSync(outDir, { recursive: true });
  const stamp = dateIso.slice(0, 16).replace(/[:T]/g, "-");
  const report = renderReport({
    requested: scenarios.length, results, costUsd: budget.costUsd, inputTokens: budget.inputTokens,
    outputTokens: budget.outputTokens, limitUsd: budget.limitUsd, stoppedByBudget, dateIso,
  });
  writeFileSync(new URL(`informe-${stamp}.md`, outDir), report);
  writeFileSync(new URL(`conversaciones-${stamp}.json`, outDir), JSON.stringify(results, null, 2));
  const failures = dedupeFailures(results.flatMap((r) => r.verdict?.fallas ?? []));
  const suggestions = dedupeSuggestions(results.flatMap((r) => r.verdict?.sugerencias ?? []));
  writeFileSync(new URL("pendientes.sql", outDir), exportPendingSql(failures, suggestions, () => crypto.randomUUID()));

  const valid = results.filter((r) => r.verdict && !r.verdict.entorno);
  const ok = valid.filter((r) => r.verdict?.exito).length;
  const env = results.length - valid.length;
  console.log(`Listo: ${results.length} conversaciones, éxito ${ok}/${valid.length} válidas (${env} afectadas por el entorno o sin juzgar), US$ ${budget.costUsd.toFixed(3)} (${budget.inputTokens}+${budget.outputTokens} tokens).`);
  console.log(`Informe: reports/simulador/informe-${stamp}.md · Pendientes: reports/simulador/pendientes.sql (${failures.length} errores, ${suggestions.length} sugerencias).`);
}

await main();
