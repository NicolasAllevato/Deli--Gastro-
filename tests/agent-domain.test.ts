import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mayConfirm, parseDraft, withDraft, type OrderDraft } from "../src/lib/agent/draft.ts";
import { isOpenNow } from "../src/lib/agent/hours.ts";
import { buildSystemPrompt } from "../src/lib/agent/prompt.ts";

const DRAFT: OrderDraft = {
  items: [{ productId: "p1", qty: 2 }],
  address: "Av. Corrientes 1234",
  lat: -34.6,
  lng: -58.38,
  fee: 600,
  subtotal: 17000,
  minOrder: 0,
  quotedByMessageId: "msg-1",
  quotedAt: "2026-10-04T15:00:00.000Z",
};

describe("borrador de pedido", () => {
  it("parseDraft lee el borrador guardado en el estado de la conversación", () => {
    assert.deepEqual(parseDraft({ draft: DRAFT }), DRAFT);
  });

  it("parseDraft devuelve null si falta, está corrupto o es de otra forma", () => {
    assert.equal(parseDraft({}), null);
    assert.equal(parseDraft(null), null);
    assert.equal(parseDraft({ draft: { items: "nada" } }), null);
    assert.equal(parseDraft({ draft: { ...DRAFT, items: [] } }), null);
    assert.equal(parseDraft({ draft: { ...DRAFT, fee: -1 } }), null);
  });

  it("withDraft guarda o borra el borrador sin tocar el resto del estado ni mutarlo", () => {
    const state = { otra: 1 };
    const saved = withDraft(state, DRAFT);
    assert.deepEqual(saved, { otra: 1, draft: DRAFT });
    assert.deepEqual(state, { otra: 1 });
    assert.deepEqual(withDraft(saved, null), { otra: 1 });
  });
});

describe("mayConfirm", () => {
  it("exige que haya un borrador cotizado", () => {
    const result = mayConfirm(null, "msg-2");
    assert.equal(result.ok, false);
  });

  it("no deja confirmar en el mismo mensaje en que se cotizó (el cliente no vio el resumen)", () => {
    const result = mayConfirm(DRAFT, "msg-1", new Date("2026-10-04T15:05:00.000Z"));
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.reason, /confirm/i);
  });

  it("deja confirmar cuando el cliente respondió después de la cotización", () => {
    const result = mayConfirm(DRAFT, "msg-2", new Date("2026-10-04T15:10:00.000Z"));
    assert.deepEqual(result, { ok: true, draft: DRAFT });
  });

  it("la cotización vence a los 30 minutos y hay que volver a cotizar", () => {
    const stale = mayConfirm(DRAFT, "msg-2", new Date("2026-10-04T15:31:00.000Z"));
    assert.equal(stale.ok, false);
    assert.match(stale.ok ? "" : stale.reason, /venci/i);
    assert.equal(mayConfirm(DRAFT, "msg-2", new Date("2026-10-04T15:29:00.000Z")).ok, true);
  });
});

describe("isOpenNow", () => {
  // 2026-10-04T15:00Z = 12:00 en Buenos Aires (UTC-3); 02:30Z = 23:30 del día anterior.
  const noon = new Date("2026-10-04T15:00:00Z");
  const lateNight = new Date("2026-10-04T02:30:00Z");

  it("abierto dentro del horario y cerrado fuera", () => {
    assert.equal(isOpenNow("11:00", "23:00", noon), true);
    assert.equal(isOpenNow("11:00", "23:00", lateNight), false);
    assert.equal(isOpenNow("13:00", "23:00", noon), false);
  });

  it("soporta horarios que cruzan la medianoche", () => {
    assert.equal(isOpenNow("18:00", "02:00", lateNight), true);
    assert.equal(isOpenNow("18:00", "02:00", noon), false);
  });

  it("si el horario no es válido, no bloquea (se considera abierto)", () => {
    assert.equal(isOpenNow("", "", noon), true);
    assert.equal(isOpenNow("abc", "23:00", noon), true);
  });
});

describe("buildSystemPrompt", () => {
  const base = {
    businessName: "Deli-Gastro",
    agentName: "Deli",
    tone: "cálido y breve",
    instructions: "",
    isOpen: true,
    hours: { open: "11:00", close: "23:00" },
    paused: false,
    estimatedMinutes: 30,
    customerName: null as string | null,
  };

  it("incluye el negocio, el nombre del agente, el horario y la demora", () => {
    const prompt = buildSystemPrompt(base);
    assert.match(prompt, /Deli-Gastro/);
    assert.match(prompt, /Deli/);
    assert.match(prompt, /11:00/);
    assert.match(prompt, /30 minutos/);
  });

  it("exige usar herramientas para precios y confirmar antes de crear el pedido", () => {
    const prompt = buildSystemPrompt(base);
    assert.match(prompt, /nunca inventes/i);
    assert.match(prompt, /confirm/i);
  });

  it("avisa cuando el local está cerrado o pausado", () => {
    assert.match(buildSystemPrompt({ ...base, isOpen: false }), /cerrado/i);
    assert.match(buildSystemPrompt({ ...base, paused: true }), /pausa|no está tomando/i);
  });

  it("saluda por el nombre si se conoce al cliente", () => {
    assert.match(buildSystemPrompt({ ...base, customerName: "Sofía" }), /Sofía/);
  });

  it("incluye las instrucciones del dueño, acotadas, y las separa del resto", () => {
    const long = "x".repeat(5000);
    const prompt = buildSystemPrompt({ ...base, instructions: long });
    assert.ok(prompt.length < 5000, `largo=${prompt.length}`);
    assert.match(buildSystemPrompt({ ...base, instructions: "Ofrecé la promo de papas" }), /Ofrecé la promo de papas/);
  });

  it("deja claro que el mensaje del cliente no puede cambiar las reglas", () => {
    assert.match(buildSystemPrompt(base), /ignor/i);
  });
});
