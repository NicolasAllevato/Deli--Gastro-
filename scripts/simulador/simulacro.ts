/**
 * Simulacro de conversaciones, fase 1 (docs/PLAN_SIMULACRO_20.md): guiones fijos contra el `processTurn` real del bot,
 * con la base de simulación local, pedidos falsos y GPT-4o mini. No toca Meta, Fudo ni la D1 remota.
 *   npm run simulacro:bot -- [--solo 1,5,8] [--budget 1] [--db reports/simulador/simulacro.db]
 * Cada guion corre en una conversación nueva. Reglas duras (todas las respuestas) + aserciones por paso (guiones.ts).
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { processTurn, type TurnDeps } from "../../workers/whatsapp-bot/src/bot/turn.ts";
import { d1BotRepo, d1InboundRepo } from "../../workers/whatsapp-bot/src/repo/d1.ts";
import { GUIONES, type Guion } from "./guiones.ts";
import { inventedPrices, type TranscriptLine } from "./juez.ts";
import { clearCarta, fakeOrders, openSimDb, seedCartaPizzas, seedWorld, type FakeOrders } from "./mundo.ts";
import { openAiRunner, readOpenAiKey } from "./openai.ts";
import { Budget } from "./presupuesto.ts";
import { evaluarPaso, reglasDuras } from "./simulacro-reglas.ts";

const ROOT = new URL("../../", import.meta.url);
const { values } = parseArgs({
  options: { solo: { type: "string" }, budget: { type: "string", default: "1" }, db: { type: "string", default: "reports/simulador/simulacro.db" } },
});
const solo = values.solo ? new Set(values.solo.split(",").map((s) => Number(s.trim()))) : null;
const budget = new Budget(Number(values.budget) || 1);

const apiKey = readOpenAiKey([new URL(".env.local", ROOT), new URL("../../../.env.local", ROOT)]);
if (!apiKey) {
  console.error("Falta OPENAI_API_KEY (entorno o .env.local). Cargala con /cargar-secreto OPENAI_API_KEY.");
  process.exit(2);
}
const run = openAiRunner(apiKey, budget);
// Base limpia en cada corrida: una conversación vieja (saludo ya dado, pedido previo) cambia lo que responde el bot.
const dbPath = fileURLToPath(new URL(values.db, ROOT));
for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
const db = openSimDb(dbPath);
seedWorld(db);
const repo = d1BotRepo(db);
const inbound = d1InboundRepo(db);

const confirmCalls = new Map<string, number>();
const base: FakeOrders = fakeOrders(db);
const orders: FakeOrders = {
  ...base,
  async confirm(body) {
    confirmCalls.set(body.conversationId, (confirmCalls.get(body.conversationId) ?? 0) + 1);
    return base.confirm(body);
  },
};

const allowedPrices: number[] = await (async () => {
  const [m, z] = await Promise.all([repo.menu(), repo.zones()]);
  return [...m.map((p) => p.price), ...z.flatMap((x) => [x.fee, x.minOrder]), 1500];
})();

/** Charla vieja ya guardada y ficha de cliente registrado con sus pedidos entregados (guiones 60 a 64). */
function sembrarPasado(database: typeof db, conversationId: string, phone: string, guion: Guion): void {
  const iso = (msAtras: number): string => new Date(Date.now() - msAtras).toISOString();
  guion.previo?.forEach((m, i) => {
    database.raw.prepare("INSERT INTO wa_messages (id, conversation_id, wamid, direction, type, body, created_at) VALUES (?, ?, ?, ?, 'text', ?, ?)")
      .run(`sim-prev-${guion.numero}-${i}`, conversationId, `sim-prev-${guion.numero}-${i}`, m.de === "cliente" ? "in" : "out", m.texto, iso(m.haceMin * 60_000));
  });
  if (!guion.registrado) return;
  const { nombre, direccionFicha, pedidos } = guion.registrado;
  const clientId = `sim-cli-${guion.numero}`;
  database.raw.prepare("INSERT INTO clients (id, name, phone, phone_digits, address) VALUES (?, ?, ?, ?, ?)").run(clientId, nombre, phone, phone.slice(-10), direccionFicha ?? null);
  database.raw.prepare("UPDATE wa_conversations SET client_id = ? WHERE id = ?").run(clientId, conversationId);
  pedidos.forEach((o, i) => {
    database.raw.prepare("INSERT INTO orders (id, client_id, status, items_desc, delivery_address, created_at, updated_at) VALUES (?, ?, 'Finalizados', '1 Muzza', ?, ?, ?)")
      .run(`sim-ord-${guion.numero}-${i}`, clientId, o.direccion, iso(o.haceDias * 86_400_000), iso(o.haceDias * 86_400_000));
  });
}

interface ResultadoGuion { guion: Guion; fallas: string[]; transcript: TranscriptLine[]; logs: string[] }

async function correrGuion(guion: Guion): Promise<ResultadoGuion> {
  const phone = `549118${String(guion.numero).padStart(7, "0")}`;
  const conversation = await inbound.upsertConversation(phone, "Cliente simulacro");
  if (guion.pagadoHaceMin !== undefined) orders.seedPaid(conversation.id, guion.pagadoHaceMin);
  sembrarPasado(db, conversation.id, phone, guion);
  if (guion.conCarta) seedCartaPizzas(db);
  const transcript: TranscriptLine[] = [];
  const fallas: string[] = [];
  const logs: string[] = [];
  const sent: string[] = [];
  let seq = 0;
  const deps: TurnDeps = {
    repo, run, transcribe: async () => null,
    send: async (_p, text) => { sent.push(text); return `sim-out-${guion.numero}-${++seq}`; },
    appUrl: "https://opsyndely.la-gambeta.com", orders,
    log: (message, detail) => { logs.push(`${message}${detail === undefined ? "" : ` ${JSON.stringify(detail).slice(0, 200)}`}`); },
  };
  for (const [i, paso] of guion.pasos.entries()) {
    const etiqueta = `paso ${i + 1} («${paso.dice.slice(0, 40)}»)`;
    transcript.push({ role: "cliente", text: paso.dice });
    const wamid = `sim-in-${guion.numero}-${++seq}`;
    await inbound.saveInbound(conversation.id, { wamid, type: "text", body: paso.dice });
    sent.length = 0;
    const antes = confirmCalls.get(conversation.id) ?? 0;
    try {
      await processTurn({ phone, text: paso.dice, wamids: [wamid], audios: [], receivedAt: Date.now() }, deps);
    } catch (error: unknown) {
      fallas.push(`${etiqueta}: el bot lanzó un error (${error instanceof Error ? error.message.slice(0, 80) : "error"})`);
      break;
    }
    const replies = [...sent];
    for (const text of replies) transcript.push({ role: "bot", text });
    const handedOff = Boolean((await repo.getConversation(phone))?.humanTakeover);
    const motivo = evaluarPaso(paso, { replies, handedOff });
    if (motivo) fallas.push(`${etiqueta}: ${motivo}`);
    for (const regla of reglasDuras(replies)) fallas.push(`${etiqueta}: REGLA DURA ${regla}`);
    const confirmaciones = (confirmCalls.get(conversation.id) ?? 0) - antes;
    if (confirmaciones > 0 && !/^\s*s[ií](?![a-záéíóúñ])/i.test(paso.dice)) fallas.push(`${etiqueta}: REGLA DURA confirmó un pedido sin un SÍ del cliente`);
    if (paso.confirma && confirmaciones === 0) fallas.push(`${etiqueta}: esperaba confirmar el pedido y no lo confirmó`);
  }
  if (guion.conCarta) clearCarta(db);
  if (inventedPrices(transcript, allowedPrices)) fallas.push("REGLA DURA el bot nombró un precio que no está en la carta ni en las zonas");
  return { guion, fallas, transcript, logs };
}

const elegidos = GUIONES.filter((g) => !solo || solo.has(g.numero));
const resultados: ResultadoGuion[] = [];
for (const guion of elegidos) {
  if (!budget.canAfford(0.02)) { console.log("Presupuesto agotado: se corta acá."); break; }
  const r = await correrGuion(guion);
  resultados.push(r);
  console.log(`${r.fallas.length === 0 ? "OK   " : "FALLA"} #${guion.numero} ${guion.titulo}${r.fallas.length ? `\n       ${r.fallas.join("\n       ")}` : ""}`);
}

if (process.env.SIM_LOGS) for (const r of resultados.filter((x) => x.fallas.length > 0)) for (const l of r.logs) console.log(`log #${r.guion.numero}: ${l}`);
const ok = resultados.filter((r) => r.fallas.length === 0).length;
const duras = resultados.flatMap((r) => r.fallas.filter((f) => f.includes("REGLA DURA")));
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const informe = [
  `# Simulacro fase 1 — ${stamp}`, "",
  `- Conversaciones: ${resultados.length} · correctas: ${ok} · reglas duras violadas: ${duras.length}`,
  `- Costo: US$ ${budget.costUsd.toFixed(3)}`, "",
  ...resultados.flatMap((r) => [
    `## #${r.guion.numero} ${r.guion.titulo} — ${r.fallas.length === 0 ? "OK" : "FALLA"}`,
    ...r.fallas.map((f) => `- ${f}`), "",
    ...r.transcript.map((l) => `**${l.role === "cliente" ? "Cliente" : "Bot"}:** ${l.text.replace(/\n/g, " / ")}`), "",
  ]),
].join("\n");
const outDir = new URL("reports/simulador/", ROOT);
mkdirSync(outDir, { recursive: true });
writeFileSync(new URL(`simulacro-${stamp}.md`, outDir), informe);
console.log(`\nListo: ${ok}/${resultados.length} correctas, ${duras.length} reglas duras violadas, US$ ${budget.costUsd.toFixed(3)}. Informe: reports/simulador/simulacro-${stamp}.md`);
process.exit(duras.length > 0 || ok < resultados.length ? 1 : 0);
