/** Caminos de WhatsApp: respuestas sin duplicar, DLQ, reintento del guardado, anti-replay y teléfonos AR. */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./helpers/sqlite-d1.ts";
import { DEAD_SEQ, d1Ledger, handleDeadTurn, onceSend, turnKey, type ReplyLedger } from "../workers/whatsapp-bot/src/turn-ledger.ts";
import { withRetry } from "../workers/whatsapp-bot/src/entry.ts";
import { claimNonce } from "../src/lib/data/bot-nonces.ts";
import { toArgentineWhatsApp } from "../src/lib/whatsapp/phone.ts";
import { signBotRequest, verifyBotRequest } from "../src/lib/bot-internal/signature.ts";
import { signRequest } from "../workers/whatsapp-bot/src/orders/client.ts";

function memLedger(): ReplyLedger & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  return {
    rows,
    get: async (k, s) => rows.get(`${k}|${s}`) ?? null,
    put: async (k, s, w) => { if (!rows.has(`${k}|${s}`)) rows.set(`${k}|${s}`, w); },
  };
}

const turn = { phone: "5491155550101", text: "hola", wamids: ["w2", "w1"], audios: [], receivedAt: 1 };

describe("respuestas por turno sin duplicar", () => {
  it("la clave del turno no depende del orden de los wamids", () => {
    assert.equal(turnKey(turn), turnKey({ ...turn, wamids: ["w1", "w2"] }));
  });

  it("un reintento no vuelve a mandar lo ya enviado", async () => {
    const ledger = memLedger();
    const sent: string[] = [];
    const send = async (_p: string, t: string) => { sent.push(t); return `wamid-${sent.length}`; };
    const first = onceSend(send, ledger, "k");
    assert.equal(await first("p", "a"), "wamid-1");
    // El turno falló después de la primera respuesta: la cola lo reintenta.
    const retry = onceSend(send, ledger, "k");
    assert.equal(await retry("p", "a"), "wamid-1");
    assert.equal(await retry("p", "b"), "wamid-2");
    assert.deepEqual(sent, ["a", "b"]);
  });

  it("el registro D1 guarda y no pisa", async () => {
    const db = createTestDb();
    const ledger = d1Ledger(db);
    await ledger.put("k", "0", "w1");
    await ledger.put("k", "0", "w2");
    assert.equal(await ledger.get("k", "0"), "w1");
    assert.equal(await ledger.get("k", "1"), null);
  });
});

describe("DLQ: turno agotado", () => {
  let calls: string[];
  let ledger: ReturnType<typeof memLedger>;
  const conversation = { id: "c1", phone: "5491155550101" };
  const deps = () => ({
    repo: {
      getConversation: async (p: string) => (p === conversation.phone ? (conversation as never) : null),
      saveOutbound: async (_c: string, w: string) => { calls.push(`save:${w}`); },
      setTakeover: async (c: string) => { calls.push(`takeover:${c}`); },
    },
    ledger,
    send: async () => { calls.push("send"); return "wdlq"; },
    failureText: "Perdón, tuve un problema",
    log: () => {},
  });
  beforeEach(() => { calls = []; ledger = memLedger(); });

  it("avisa una sola vez, pasa a una persona y queda en el panel", async () => {
    assert.equal(await handleDeadTurn(turn, deps()), "notified");
    assert.deepEqual(calls, ["takeover:c1", "send", "save:wdlq"]);
    assert.equal(await handleDeadTurn(turn, deps()), "already_notified");
    assert.equal(calls.filter((c) => c === "send").length, 1);
    assert.equal(ledger.rows.get(`${turnKey(turn)}|${DEAD_SEQ}`), "wdlq");
  });

  it("sin conversación no manda nada", async () => {
    assert.equal(await handleDeadTurn({ ...turn, phone: "999" }, deps()), "no_conversation");
    assert.deepEqual(calls, []);
  });
});

describe("guardado del entrante con reintento", () => {
  it("reintenta fallas transitorias y después propaga", async () => {
    let n = 0;
    const noSleep = async () => {};
    assert.equal(await withRetry(async () => { n += 1; if (n < 3) throw new Error("D1"); return "ok"; }, [1, 1], noSleep), "ok");
    await assert.rejects(withRetry(async () => { throw new Error("caído"); }, [1], noSleep), /caído/);
  });
});

describe("anti-replay de las llamadas internas", () => {
  it("un nonce se acepta una sola vez y vence", async () => {
    const db = createTestDb();
    assert.equal(await claimNonce(db, "n-1234567890abcdef", 1_000_000), true);
    assert.equal(await claimNonce(db, "n-1234567890abcdef", 1_010_000), false);
    // Pasado el vencimiento (120 s) se limpia.
    assert.equal(await claimNonce(db, "n-1234567890abcdef", 1_000_000 + 200_000), true);
  });

  it("la firma del Worker con nonce verifica en la app; cambiar el nonce la invalida", async () => {
    const secret = "s".repeat(40);
    const parts = { timestamp: "1000", nonce: "11111111-2222-3333-4444-555555555555", method: "POST", path: "/api/internal/bot/quote", body: "{}" };
    const sig = await signRequest(secret, parts);
    assert.equal(sig, signBotRequest(secret, parts));
    const base = { secrets: [secret], method: "POST", path: parts.path, body: "{}", timestamp: "1000", signature: sig, nowMs: 1_000_000 };
    assert.deepEqual(verifyBotRequest({ ...base, nonce: parts.nonce }), { ok: true });
    assert.equal(verifyBotRequest({ ...base, nonce: "99999999-2222-3333-4444-555555555555" }).ok, false);
    assert.equal(verifyBotRequest({ ...base, nonce: "corto" }).ok, false);
  });
});

describe("teléfonos del resumen diario", () => {
  it("agrega 549 a los números argentinos", () => {
    assert.equal(toArgentineWhatsApp("11 5619-4690"), "5491156194690");
    assert.equal(toArgentineWhatsApp("011 5619-4690"), "5491156194690");
    assert.equal(toArgentineWhatsApp("+54 11 5619-4690"), "5491156194690");
    assert.equal(toArgentineWhatsApp("+54 9 11 5619-4690"), "5491156194690");
    assert.equal(toArgentineWhatsApp("+1 415 555 0101"), "14155550101");
  });
});
