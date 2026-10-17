import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isCronAuthorized } from "../src/lib/whatsapp/cron-auth.ts";
import { runSurveys, type SurveyDeps } from "../src/lib/whatsapp/surveys.ts";

describe("isCronAuthorized", () => {
  it("acepta solo el Bearer exacto", () => {
    assert.equal(isCronAuthorized("Bearer s3cret", "s3cret"), true);
    assert.equal(isCronAuthorized("Bearer otro", "s3cret"), false);
    assert.equal(isCronAuthorized("s3cret", "s3cret"), false);
    assert.equal(isCronAuthorized("Bearer s3cret ", "s3cret"), false);
  });

  it("falla cerrado sin secreto o sin encabezado", () => {
    assert.equal(isCronAuthorized("Bearer ", ""), false);
    assert.equal(isCronAuthorized("Bearer ", undefined), false);
    assert.equal(isCronAuthorized(null, "s3cret"), false);
    assert.equal(isCronAuthorized("", "s3cret"), false);
  });
});

const IN_WINDOW = new Date("2026-10-11T15:00:00Z"); // 12:00 en Buenos Aires
const NIGHT = new Date("2026-10-11T04:00:00Z"); // 01:00 en Buenos Aires

interface Order { id: string }

function fakeDeps(overrides: Partial<SurveyDeps<Order, string>> = {}) {
  const events: string[] = [];
  const deps: SurveyDeps<Order, string> = {
    listDue: async () => { events.push("list"); return [{ id: "a" }, { id: "b" }]; },
    reviewedIds: async () => new Set<string>(),
    loadTarget: async (o) => `target-${o.id}`,
    claim: async (id) => { events.push(`claim:${id}`); return true; },
    release: async (id) => { events.push(`release:${id}`); },
    send: async (o) => { events.push(`send:${o.id}`); return true; },
    ...overrides,
  };
  return { deps, events };
}

describe("runSurveys", () => {
  it("fuera de la ventana horaria no consulta ni envía nada", async () => {
    const { deps, events } = fakeDeps();
    const result = await runSurveys(deps, NIGHT);
    assert.deepEqual(events, []);
    assert.equal(result.sent, 0);
    assert.equal(result.outsideWindow, true);
  });

  it("reclama cada pedido ANTES de enviar", async () => {
    const { deps, events } = fakeDeps();
    const result = await runSurveys(deps, IN_WINDOW);
    assert.equal(result.sent, 2);
    assert.deepEqual(events, ["list", "claim:a", "send:a", "claim:b", "send:b"]);
  });

  it("no envía si otra ejecución ya reclamó el pedido (ejecuciones solapadas)", async () => {
    const { deps, events } = fakeDeps({ claim: async (id) => id !== "a" });
    const result = await runSurveys(deps, IN_WINDOW);
    assert.equal(result.sent, 1);
    assert.ok(!events.includes("send:a"));
  });

  it("salta pedidos con reseña y los que no tienen conversación de WhatsApp", async () => {
    const { deps, events } = fakeDeps({
      reviewedIds: async () => new Set(["a"]),
      loadTarget: async (o) => (o.id === "b" ? null : "t"),
    });
    const result = await runSurveys(deps, IN_WINDOW);
    assert.equal(result.sent, 0);
    assert.equal(result.skipped, 2);
    assert.deepEqual(events, ["list"]);
  });

  it("si el envío falla o lanza, libera el pedido para reintentar y sigue con los demás", async () => {
    const { deps, events } = fakeDeps({
      send: async (o) => {
        if (o.id === "a") throw new Error("Meta caído");
        return true;
      },
    });
    const result = await runSurveys(deps, IN_WINDOW);
    assert.equal(result.sent, 1);
    assert.equal(result.failed, 1);
    assert.deepEqual(events, ["list", "claim:a", "release:a", "claim:b"]);
  });

  it("si send devuelve false (WhatsApp sin configurar) libera sin contar como enviado", async () => {
    const { deps, events } = fakeDeps({ send: async () => false });
    const result = await runSurveys(deps, IN_WINDOW);
    assert.equal(result.sent, 0);
    assert.ok(events.includes("release:a"));
  });

  it("pide solo la ventana de 30 min a 3 h", async () => {
    let range: [string, string] | null = null;
    const { deps } = fakeDeps({
      listDue: async (from, to) => { range = [from, to]; return []; },
    });
    await runSurveys(deps, IN_WINDOW);
    assert.deepEqual(range, ["2026-10-11T12:00:00.000Z", "2026-10-11T14:30:00.000Z"]);
  });
});
