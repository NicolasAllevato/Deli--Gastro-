import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

const { rest } = await import("../workers/fudo-gateway/src/db.ts");

const env = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "key" };
const realFetch = globalThis.fetch;

function stubFetch(status: number, body: string): void {
  // Un 204 no admite cuerpo: un string vacío se manda como `null`.
  globalThis.fetch = (async () => new Response(body === "" ? null : body, { status })) as typeof fetch;
}

describe("rest (PostgREST del Worker de Fudo)", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("devuelve el JSON cuando hay cuerpo", async () => {
    stubFetch(200, '[{"id":1}]');
    assert.deepEqual(await rest(env, "products"), [{ id: 1 }]);
  });

  it("tolera una respuesta vacía (Prefer: return=minimal responde 201/204 sin cuerpo)", async () => {
    stubFetch(201, "");
    assert.equal(await rest(env, "fudo_product_map", { method: "POST" }), undefined);
    stubFetch(204, "");
    assert.equal(await rest(env, "products?id=eq.1", { method: "PATCH" }), undefined);
  });

  it("lanza con el estado y un resumen cuando Supabase responde error", async () => {
    stubFetch(409, "duplicate key");
    await assert.rejects(() => rest(env, "products?select=id"), /Supabase products 409: duplicate key/);
  });
});
