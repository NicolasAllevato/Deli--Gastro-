import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { freshPendingNotice } from "../src/lib/courier-shift-notice.ts";

const shift = (id: string, courierName: string, status: "pending" | "approved" | "rejected" = "pending") => ({
  id,
  userId: `user-${id}`,
  courierName,
  day: "2026-11-10",
  status,
  requestedAt: "2026-11-10T12:00:00.000Z",
  decidedAt: null,
});

describe("aviso al admin cuando aparece una solicitud de habilitación nueva", () => {
  it("sin solicitudes pendientes no hay nada que anunciar", () => {
    const result = freshPendingNotice([], new Set());
    assert.equal(result.notice, null);
    assert.equal(result.seen.size, 0);
  });

  it("anuncia a un repartidor nuevo y lo marca como visto", () => {
    const result = freshPendingNotice([shift("a", "Nora")], new Set());
    assert.equal(result.notice, "Nora espera que lo habilites hoy.");
    assert.deepEqual([...result.seen], ["a"]);
  });

  it("un refresco con la misma lista no vuelve a anunciar nada", () => {
    const first = freshPendingNotice([shift("a", "Nora")], new Set());
    const again = freshPendingNotice([shift("a", "Nora")], first.seen);
    assert.equal(again.notice, null);
  });

  it("cuando llega otra solicitud, anuncia solo la nueva", () => {
    const first = freshPendingNotice([shift("a", "Nora")], new Set());
    const next = freshPendingNotice([shift("a", "Nora"), shift("b", "Beto")], first.seen);
    assert.equal(next.notice, "Beto espera que lo habilites hoy.");
    assert.deepEqual([...next.seen].sort(), ["a", "b"]);
  });

  it("varias nuevas a la vez se anuncian juntas, en plural", () => {
    const result = freshPendingNotice([shift("a", "Nora"), shift("b", "Beto")], new Set());
    assert.equal(result.notice, "Nora, Beto esperan que los habilites hoy.");
  });

  it("las solicitudes ya resueltas no se anuncian", () => {
    const result = freshPendingNotice([shift("a", "Nora", "approved"), shift("b", "Beto", "rejected")], new Set());
    assert.equal(result.notice, null);
  });

  it("una solicitud que se resolvió y desapareció de pendientes no se anuncia de nuevo", () => {
    const first = freshPendingNotice([shift("a", "Nora")], new Set());
    const resolved = freshPendingNotice([shift("a", "Nora", "approved")], first.seen);
    assert.equal(resolved.notice, null);
  });

  it("no modifica el conjunto de visto que recibe", () => {
    const seen = new Set<string>();
    freshPendingNotice([shift("a", "Nora")], seen);
    assert.equal(seen.size, 0);
  });
});
