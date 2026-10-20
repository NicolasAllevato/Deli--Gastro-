import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BATCH_POLICY,
  addMessage,
  combineBatch,
  emptyBatch,
  flushAt,
  isFull,
  type BufferedMessage,
} from "../workers/whatsapp-bot/src/batching.ts";

const msg = (wamid: string, text: string, at: number): BufferedMessage => ({ wamid, text, at, kind: "text" });

describe("apilador: agregar mensajes", () => {
  it("agrega en orden y descarta wamid repetidos (Meta reintenta)", () => {
    let batch = emptyBatch();
    batch = addMessage(batch, msg("a", "hola", 1000));
    batch = addMessage(batch, msg("b", "quiero 2 muzza", 2000));
    batch = addMessage(batch, msg("a", "hola", 2500));
    assert.deepEqual(batch.messages.map((m) => m.wamid), ["a", "b"]);
    assert.equal(batch.firstAt, 1000);
  });

  it("no muta el lote anterior", () => {
    const before = emptyBatch();
    addMessage(before, msg("a", "hola", 1000));
    assert.equal(before.messages.length, 0);
  });

  it("se llena al llegar al máximo de mensajes", () => {
    let batch = emptyBatch();
    for (let i = 0; i < BATCH_POLICY.maxMessages; i++) batch = addMessage(batch, msg(`m${i}`, "x", i * 100));
    assert.equal(isFull(batch), true);
  });
});

describe("apilador: cuándo responder", () => {
  it("espera el silencio después del último mensaje", () => {
    let batch = addMessage(emptyBatch(), msg("a", "hola", 0));
    assert.equal(flushAt(batch), BATCH_POLICY.quietMs);
    batch = addMessage(batch, msg("b", "quiero pedir", 2000));
    assert.equal(flushAt(batch), 2000 + BATCH_POLICY.quietMs);
  });

  it("nunca espera más que el máximo desde el primer mensaje", () => {
    let batch = emptyBatch();
    for (let t = 0; t <= 20_000; t += 3000) batch = addMessage(batch, msg(`m${t}`, "x", t));
    assert.equal(flushAt(batch), BATCH_POLICY.maxWaitMs);
  });

  it("un lote vacío no tiene hora de respuesta", () => {
    assert.equal(flushAt(emptyBatch()), null);
  });
});

describe("apilador: unir el lote en un solo turno", () => {
  it("une los textos en orden de llegada, uno por línea", () => {
    const batch = [msg("b", "con jamón", 2000), msg("a", "quiero una pizza", 1000), msg("c", "a Belgrano 123", 3000)]
      .reduce(addMessage, emptyBatch());
    assert.equal(combineBatch(batch).text, "quiero una pizza\ncon jamón\na Belgrano 123");
    assert.deepEqual(combineBatch(batch).wamids, ["a", "b", "c"]);
  });

  it("marca audios y ubicaciones para que el respondedor sepa qué llegó", () => {
    const batch = addMessage(addMessage(emptyBatch(), { wamid: "a", text: "dos empanadas", at: 1, kind: "audio" }), {
      wamid: "b",
      text: "-34.6,-58.4",
      at: 2,
      kind: "location",
    });
    assert.equal(combineBatch(batch).text, "[audio] dos empanadas\n[ubicación] -34.6,-58.4");
  });

  it("deja una marca para los audios sin transcribir y los lista aparte", () => {
    const batch = [
      msg("a", "quiero pedir", 1),
      { wamid: "b", text: "", at: 2, kind: "audio" as const, mediaId: "media-1" },
    ].reduce(addMessage, emptyBatch());
    const turn = combineBatch(batch);
    assert.equal(turn.text, "quiero pedir\n[audio:b]");
    assert.deepEqual(turn.audios, [{ wamid: "b", mediaId: "media-1" }]);
  });

  it("ignora mensajes vacíos", () => {
    const batch = [msg("a", "  ", 1), msg("b", "hola", 2)].reduce(addMessage, emptyBatch());
    assert.equal(combineBatch(batch).text, "hola");
  });
});
