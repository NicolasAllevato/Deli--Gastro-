import { describe, it, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import "./helpers/alias.ts";

const { handleWrite } = await import("../workers/fudo-gateway/src/sales-write.ts");
const worker = { fetch: (r: Request, e: never) => handleWrite(r, e) };
const { writeSignaturePayload, parseCreateSale, resetWriteRateLimit, isWriteRoute } = await import("../workers/fudo-gateway/src/sales-write.ts");
const { hmacHex } = await import("../workers/fudo-gateway/src/signature.ts");

describe("fudo-gateway: rutas de escritura", () => {
  it("reconoce solo las rutas de escritura de ventas", () => {
    assert.equal(isWriteRoute("POST", "/sales"), true);
    assert.equal(isWriteRoute("POST", "/payments"), true);
    assert.equal(isWriteRoute("PATCH", "/sales/99/state"), true);
    assert.equal(isWriteRoute("GET", "/sales"), false);
    assert.equal(isWriteRoute("GET", "/payment-methods"), false);
    assert.equal(isWriteRoute("POST", "/sync"), false);
  });
});

const SECRET = "s3cr3t";
const realFetch = globalThis.fetch;

function kv() {
  const m = new Map<string, string>();
  return {
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => void m.set(k, v),
    delete: async (k: string) => void m.delete(k),
    map: m,
  };
}

function env(overrides: Record<string, unknown> = {}) {
  return {
    FUDO_GATEWAY_SECRET: SECRET,
    FUDO_AUTH_URL: "https://auth.test",
    FUDO_PUBLIC_API_URL: "https://api.test",
    FUDO_API_KEY: "k",
    FUDO_API_SECRET: "s",
    ENABLE_WRITES: "true",
    FUDO_KV: kv(),
    ...overrides,
  } as never;
}

async function signed(method: string, path: string, body: unknown, secret = SECRET, ts = String(Date.now())): Promise<Request> {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const sig = await hmacHex(writeSignaturePayload(method, path, ts, raw), secret);
  return new Request(`https://gw.test${path}`, {
    method,
    headers: { "content-type": "application/json", "x-gateway-signature": sig, "x-gateway-ts": ts },
    ...(raw ? { body: raw } : {}),
  });
}

type Call = { url: string; method: string; body: unknown };
function stubFudo(handler: (c: Call) => Response): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://auth.test")) return Response.json({ token: "tok", exp: Math.floor(Date.now() / 1000) + 3600 });
    const c = { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(c);
    return handler(c);
  }) as typeof fetch;
  return calls;
}

const SALE = {
  externalId: "7b0c3c55-1111-4222-8333-444455556666",
  lines: [
    { fudoProductId: 10, quantity: 2, price: 1500 },
    { fudoProductId: 11, quantity: 1, price: 900 },
  ],
  customerName: "Ana",
  delivery: { address: "Calle 1 123", phone: "1122334455" },
};

describe("fudo-gateway: escrituras", () => {
  beforeEach(() => resetWriteRateLimit());
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("rechaza sin firma (401) y con firma de otra ruta", async () => {
    const calls = stubFudo(() => Response.json({}));
    const noSig = new Request("https://gw.test/sales", { method: "POST", body: JSON.stringify(SALE) });
    assert.equal((await worker.fetch(noSig, env())).status, 401);
    const other = await signed("POST", "/payments", SALE);
    const replay = new Request("https://gw.test/sales", { method: "POST", headers: other.headers, body: JSON.stringify(SALE) });
    assert.equal((await worker.fetch(replay, env())).status, 401);
    assert.equal((await worker.fetch(await signed("POST", "/sales", SALE, "otro"), env())).status, 401);
    assert.equal(calls.length, 0);
  });

  it("rechaza una firma vieja (más de 5 minutos)", async () => {
    stubFudo(() => Response.json({}));
    const old = await signed("POST", "/sales", SALE, SECRET, String(Date.now() - 10 * 60_000));
    assert.equal((await worker.fetch(old, env())).status, 401);
  });

  it("con ENABLE_WRITES apagado responde 403 WRITES_DISABLED y no llama a Fudo", async () => {
    const calls = stubFudo(() => Response.json({}));
    const res = await worker.fetch(await signed("POST", "/sales", SALE), env({ ENABLE_WRITES: "false" }));
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { details: { code: string } }).details.code, "WRITES_DISABLED");
    assert.equal(calls.length, 0);
  });

  it("crea la venta TAKEAWAY con dirección y teléfono en comment y líneas secuenciales", async () => {
    let next = 500;
    const calls = stubFudo((c) => Response.json({ data: { id: String(c.url.endsWith("/sales") ? 99 : next++), type: "x" } }, { status: 201 }));
    const res = await worker.fetch(await signed("POST", "/sales", SALE), env());
    assert.equal(res.status, 201);
    const json = (await res.json()) as { data: { saleId: number; partial: boolean; linesCreated: number } };
    assert.deepEqual(json.data, { saleId: 99, partial: false, linesCreated: 2, failedLines: [], existing: false });
    assert.equal(calls.length, 3);
    const sale = calls[0].body as { data: { attributes: { saleType: string; comment: string } } };
    assert.equal(sale.data.attributes.saleType, "TAKEAWAY");
    assert.match(sale.data.attributes.comment, /Calle 1 123/);
    assert.match(sale.data.attributes.comment, /1122334455/);
    assert.ok(calls.every((c) => c.method === "POST"));
  });

  it("si falla una línea devuelve partial:true sin reintentar", async () => {
    const calls = stubFudo((c) => {
      if (c.url.endsWith("/sales")) return Response.json({ data: { id: "99" } }, { status: 201 });
      return (c.body as { data: { relationships: { product: { data: { id: string } } } } }).data.relationships.product.data.id === "11"
        ? new Response("boom", { status: 500 })
        : Response.json({ data: { id: "1" } }, { status: 201 });
    });
    const res = await worker.fetch(await signed("POST", "/sales", SALE), env());
    const json = (await res.json()) as { data: { partial: boolean; failedLines: number[] } };
    assert.equal(json.data.partial, true);
    assert.deepEqual(json.data.failedLines, [1]);
    assert.equal(calls.length, 3);
  });

  it("es idempotente por externalId: la segunda vez no crea otra venta", async () => {
    const calls = stubFudo(() => Response.json({ data: { id: "99" } }, { status: 201 }));
    const e = env();
    await worker.fetch(await signed("POST", "/sales", SALE), e);
    const res = await worker.fetch(await signed("POST", "/sales", SALE), e);
    const json = (await res.json()) as { data: { saleId: number; existing: boolean } };
    assert.equal(json.data.existing, true);
    assert.equal(json.data.saleId, 99);
    assert.equal(calls.filter((c) => c.url.endsWith("/sales")).length, 1);
  });

  it("si Fudo rechaza la venta no reintenta y responde 502", async () => {
    const calls = stubFudo(() => new Response("error", { status: 500 }));
    const res = await worker.fetch(await signed("POST", "/sales", SALE), env());
    assert.equal(res.status, 502);
    assert.equal(calls.length, 1);
  });

  it("valida ids y tope de 100 líneas", () => {
    assert.equal(parseCreateSale({ ...SALE, lines: [{ fudoProductId: "1/../2", quantity: 1 }] }).ok, false);
    assert.equal(parseCreateSale({ ...SALE, lines: Array.from({ length: 101 }, () => ({ fudoProductId: 1, quantity: 1 })) }).ok, false);
    assert.equal(parseCreateSale({ ...SALE, lines: [] }).ok, false);
    assert.equal(parseCreateSale({ ...SALE, externalId: "x" }).ok, false);
    assert.equal(parseCreateSale(SALE).ok, true);
  });

  it("PATCH /sales/:id/state valida el id y el estado", async () => {
    const calls = stubFudo(() => Response.json({ data: { id: "99" } }));
    assert.equal((await worker.fetch(await signed("PATCH", "/sales/abc/state", { state: "CLOSED" }), env())).status, 404);
    assert.equal((await worker.fetch(await signed("PATCH", "/sales/99/state", { state: "BORRAR" }), env())).status, 400);
    const ok = await worker.fetch(await signed("PATCH", "/sales/99/state", { state: "CANCELED" }), env());
    assert.equal(ok.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "PATCH");
    assert.match(calls[0].url, /\/sales\/99$/);
  });

  it("POST /payments registra el pago", async () => {
    const calls = stubFudo(() => Response.json({ data: { id: "77" } }, { status: 201 }));
    const bad = await worker.fetch(await signed("POST", "/payments", { saleId: 99, paymentMethodId: "x", amount: 10 }), env());
    assert.equal(bad.status, 400);
    const res = await worker.fetch(await signed("POST", "/payments", { saleId: 99, paymentMethodId: 3, amount: 3900 }), env());
    assert.equal(res.status, 201);
    assert.equal(((await res.json()) as { data: { paymentId: number } }).data.paymentId, 77);
    assert.equal(calls.length, 1);
  });

  it("limita la cantidad de escrituras por minuto (429)", async () => {
    stubFudo(() => Response.json({ data: { id: "1" } }, { status: 201 }));
    const e = env();
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (await worker.fetch(await signed("POST", "/payments", { saleId: 99, paymentMethodId: 3, amount: 1 }), e)).status;
    }
    assert.equal(last, 429);
  });
});

const { signWrite, fudoWriteGateway } = await import("../src/lib/fudo/sales-gateway.ts");

describe("app ↔ gateway: firma de escrituras", () => {
  it("la firma de la app es la que verifica el Worker", async () => {
    const body = JSON.stringify({ state: "CLOSED" });
    const expected = await hmacHex(writeSignaturePayload("PATCH", "/sales/9/state", "1700000000000", body), SECRET);
    assert.equal(signWrite("PATCH", "/sales/9/state", "1700000000000", body, SECRET), expected);
  });

  it("una venta firmada por la app pasa la verificación del Worker de punta a punta", async () => {
    resetWriteRateLimit();
    const e = env({ ENABLE_WRITES: "false" });
    const appFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => handleWrite(new Request(String(input), init), e)) as typeof fetch;
    try {
      const gw = fudoWriteGateway({ url: "https://gw.test", secret: SECRET });
      const r = await gw("POST", "/sales", { externalId: "7b0c3c55-1111-4222-8333-444455556666", lines: [{ fudoProductId: 1, quantity: 1 }] });
      assert.deepEqual(r, { ok: false, status: 403, error: "Escrituras en Fudo deshabilitadas.", code: "WRITES_DISABLED" });
    } finally {
      globalThis.fetch = appFetch;
    }
  });

  it("sin configuración no llama a nadie", async () => {
    const r = await fudoWriteGateway(null)("POST", "/sales", {});
    assert.equal(r.ok, false);
  });
});
