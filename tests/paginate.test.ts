import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchAllExact } from "../src/lib/reports/paginate.ts";

interface Row { id: string; created_at: string }

/** Simula la consulta: orden por created_at desc, filtro `lte` y tope por página. */
const source = (rows: Row[], pageSize: number) => (upTo: string | null) => {
  const sorted = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const data = sorted.filter((r) => upTo === null || r.created_at <= upTo).slice(0, pageSize);
  return Promise.resolve({ data, error: null });
};

const row = (id: string, created_at: string): Row => ({ id, created_at });

describe("fetchAllExact", () => {
  it("trae todo cuando entra en una página", async () => {
    const rows = [row("a", "2026-01-02"), row("b", "2026-01-01")];
    assert.equal((await fetchAllExact(source(rows, 5), 5)).length, 2);
  });

  it("no pierde filas con el mismo created_at en el borde de página", async () => {
    // Página de 3: el borde cae entre "c" y "d", que comparten instante.
    const rows = [row("a", "2026-01-04"), row("b", "2026-01-03"), row("c", "2026-01-02"), row("d", "2026-01-02"), row("e", "2026-01-01")];
    const got = await fetchAllExact(source(rows, 3), 3);
    assert.deepEqual(got.map((r) => r.id).sort(), ["a", "b", "c", "d", "e"]);
  });

  it("no duplica filas", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => row(`r${i}`, `2026-01-0${i + 1}`));
    const got = await fetchAllExact(source(rows, 3), 3);
    assert.equal(new Set(got.map((r) => r.id)).size, got.length);
    assert.equal(got.length, 7);
  });

  it("lanza si hay más empates que el tamaño de página", async () => {
    const rows = Array.from({ length: 6 }, (_, i) => row(`r${i}`, "2026-01-01"));
    await assert.rejects(fetchAllExact(source(rows, 3), 3), /incompleta/);
  });

  it("lanza al llegar al tope de páginas en vez de truncar", async () => {
    const rows = Array.from({ length: 9 }, (_, i) => row(`r${i}`, `2026-01-0${i + 1}`));
    await assert.rejects(fetchAllExact(source(rows, 2), 2, 2), /incompleta/);
  });

  it("propaga el error de la base", async () => {
    await assert.rejects(
      fetchAllExact<Row>(() => Promise.resolve({ data: null, error: { message: "boom" } })),
      /boom/,
    );
  });
});
