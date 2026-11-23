import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { respond } from "../workers/whatsapp-bot/src/ai/responder.ts";

function fakeRun() {
  const seen: Array<Record<string, unknown>> = [];
  let turn = 0;
  const run = async (_model: string, input: Record<string, unknown>) => {
    seen.push(input);
    turn += 1;
    if (turn === 1) return { choices: [{ message: { tool_calls: [{ id: "c1", function: { name: "quote_order", arguments: "{}" } }] } }] };
    return { choices: [{ message: { content: "listo" } }] };
  };
  return { run, seen };
}

const tool = { name: "quote_order", description: "x", parameters: { type: "object", properties: {} }, run: async () => ({ ok: true }) };

describe("responder: reintento de un pedido obliga a usar una herramienta", () => {
  it("con forceToolFirst la primera vuelta pide tool_choice required y las siguientes no", async () => {
    const { run, seen } = fakeRun();
    const out = await respond(run, { system: "s", history: [], userText: "u", tools: [tool], forceToolFirst: true });
    assert.equal(out, "listo");
    assert.equal(seen[0].tool_choice, "required");
    assert.equal(seen[1].tool_choice, undefined);
  });

  it("sin forceToolFirst no fuerza nada", async () => {
    const { run, seen } = fakeRun();
    await respond(run, { system: "s", history: [], userText: "u", tools: [tool] });
    assert.equal(seen[0].tool_choice, undefined);
  });
});
