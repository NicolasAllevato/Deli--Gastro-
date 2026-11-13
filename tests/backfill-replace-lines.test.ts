import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { replaceOrderLines } = await import("../scripts/lib/replace-order-lines.mjs");

type Row = Record<string, unknown>;

/** PostgREST falso en memoria para order_items; `failOn` hace fallar POST o DELETE. */
let next = 100;
function fakeRest(initial: Row[], failOn: "POST" | "DELETE" | null = null) {
  let rows = [...initial];
  const rest = async (path: string, init: { method?: string; body?: string } = {}) => {
    const method = init.method ?? "GET";
    if (method === failOn) throw new Error(`Supabase ${method} → 400`);
    if (method === "GET") return rows.filter((r) => path.includes(`order_id=eq.${r.order_id}`));
    if (method === "POST") {
      rows = [...rows, ...(JSON.parse(init.body!) as Row[]).map((r) => ({ ...r, id: `n${next++}` }))];
      return null;
    }
    const ids = /id=in\.\(([^)]*)\)/.exec(path)![1]!.split(",");
    rows = rows.filter((r) => !ids.includes(String(r.id)));
    return null;
  };
  return { rest, rows: () => rows };
}

const OLD = [
  { id: "o1", order_id: "A", name: "Producto Fudo #198", qty: 1 },
  { id: "o2", order_id: "A", name: "Producto Fudo #195", qty: 2 },
  { id: "x1", order_id: "B", name: "Otra", qty: 1 },
];
const NEW = [{ order_id: "A", name: "Combo para compartir", qty: 1 }];

describe("replaceOrderLines (backfill de Fudo)", () => {
  it("inserta las nuevas, borra solo las viejas del pedido y respalda antes de escribir", async () => {
    const db = fakeRest(OLD);
    let backup: Row[] | null = null;
    await replaceOrderLines(db.rest, "A", NEW, (prev: Row[]) => {
      backup = prev;
      assert.equal(db.rows().length, 3, "el respaldo se toma antes de cualquier escritura");
    });
    assert.deepEqual(backup!.map((r) => r.id), ["o1", "o2"]);
    assert.deepEqual(db.rows().map((r) => r.name), ["Otra", "Combo para compartir"]);
  });

  it("si el POST falla, el pedido conserva sus líneas viejas (no hay pérdida)", async () => {
    const db = fakeRest(OLD, "POST");
    await assert.rejects(replaceOrderLines(db.rest, "A", NEW));
    assert.deepEqual(db.rows(), OLD);
  });

  it("si el DELETE falla, quedan viejas y nuevas (nunca vacío) y una nueva corrida converge", async () => {
    const db = fakeRest(OLD, "DELETE");
    await assert.rejects(replaceOrderLines(db.rest, "A", NEW));
    assert.equal(db.rows().filter((r) => r.order_id === "A").length, 3);
    const retry = fakeRest(db.rows());
    await replaceOrderLines(retry.rest, "A", NEW);
    assert.deepEqual(retry.rows().filter((r) => r.order_id === "A").map((r) => r.name), ["Combo para compartir"]);
  });
});
