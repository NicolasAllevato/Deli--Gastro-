import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { anonClientName, linkAnonymousClients } = await import("../workers/fudo-gateway/src/anon-client.ts");

describe("anonClientName (igual que fudo_anonymous_client de la migración 025)", () => {
  it("usa el nombre en formato título", () => {
    assert.equal(anonClientName("  juan PEREZ ", "TAKEAWAY"), "Juan Perez");
  });
  it("sin nombre agrupa por tipo de venta", () => {
    assert.equal(anonClientName(null, "TAKEAWAY"), "Sin Nombre · Take Away");
    assert.equal(anonClientName("", "DELIVERY"), "Sin Nombre · Delivery");
    assert.equal(anonClientName(null, "EAT-IN"), "Sin Nombre · Salón");
    assert.equal(anonClientName(null, null), "Sin Nombre · Fudo");
  });
});

type Call = { path: string; method: string; body?: unknown };

function fakeRest(existing: Array<{ id: string; name: string; channel: string }>) {
  const calls: Call[] = [];
  let next = 0;
  const rest = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, body });
    if (method === "GET") return [...existing] as T;
    const rows = (body as Array<{ name: string; channel: string }>).map((r) => ({ id: `nuevo-${++next}`, ...r }));
    existing.push(...rows);
    return rows as T;
  };
  return { rest, calls };
}

describe("linkAnonymousClients", () => {
  it("asigna el cliente anónimo existente (sin distinguir mayúsculas) y crea el que falta", async () => {
    const { rest, calls } = fakeRest([{ id: "c1", name: "Juan Perez", channel: "pedidosya" }]);
    const rows = [
      { client_id: null, customer_name: "JUAN perez", fudo_source: "pedidosya", fudo_sale_type: "DELIVERY" },
      { client_id: null, customer_name: null, fudo_source: "local", fudo_sale_type: "TAKEAWAY" },
      { client_id: "real", customer_name: "Ana", fudo_source: "local", fudo_sale_type: "TAKEAWAY" },
    ];
    const out = await linkAnonymousClients(rest, rows);
    assert.equal(out[0].client_id, "c1");
    assert.equal(out[1].client_id, "nuevo-1");
    assert.equal(out[2].client_id, "real");
    assert.equal(rows[0].client_id, null, "no muta la entrada");
    const post = calls.find((c) => c.method === "POST");
    assert.deepEqual(post?.body, [{ name: "Sin Nombre · Take Away", source: "fudo", channel: "local", is_anonymous: true }]);
  });

  it("no consulta nada si todos tienen cliente", async () => {
    const { rest, calls } = fakeRest([]);
    const rows = [{ client_id: "x", customer_name: "A", fudo_source: "local", fudo_sale_type: "TAKEAWAY" }];
    assert.deepEqual(await linkAnonymousClients(rest, rows), rows);
    assert.equal(calls.length, 0);
  });

  it("crea un solo cliente para varios pedidos del mismo nombre y canal", async () => {
    const { rest, calls } = fakeRest([]);
    const row = { client_id: null, customer_name: "Lucia", fudo_source: "rappi", fudo_sale_type: "DELIVERY" };
    const out = await linkAnonymousClients(rest, [row, { ...row, customer_name: "LUCIA" }]);
    assert.equal(out[0].client_id, out[1].client_id);
    assert.equal((calls.find((c) => c.method === "POST")?.body as unknown[]).length, 1);
  });
});
