import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

const { chooseGeocodeMatch, geocodeOutcome, prepareGeocodeQuery, GEOCODE_MAX_ATTEMPTS } = await import("../src/lib/geocode-match.ts");
const { runGeocodeBackfill } = await import("../src/lib/geocode-backfill.ts");
const { geocodeNewOrders, geocodeQuota, MAX_GEOCODES_PER_RUN } = await import("../workers/fudo-gateway/src/geocode.ts");

const near = { lat: -34.6, lng: -58.39 };
const hit = (label: string, lat = -34.61, lng = -58.4) => ({ label, lat, lng });

describe("prepareGeocodeQuery", () => {
  it("saca piso y depto y deja la localidad", () => {
    assert.equal(prepareGeocodeQuery("Av. Rivadavia 1234 piso 3, 2B, Caballito"), "Av. Rivadavia 1234, Caballito");
    assert.equal(prepareGeocodeQuery("Thames 856, Depto 4, Palermo"), "Thames 856, Palermo");
  });
  it("sin altura no se busca", () => {
    assert.equal(prepareGeocodeQuery("Belgrano"), null);
    assert.equal(prepareGeocodeQuery(null), null);
  });
});

describe("chooseGeocodeMatch", () => {
  it("acepta un resultado cercano con la altura", () => {
    assert.ok(chooseGeocodeMatch("Thames 856", [hit("856, Thames, Palermo")], near));
  });
  it("descarta lo lejano", () => {
    assert.equal(chooseGeocodeMatch("Thames 856", [hit("856, Thames, Córdoba", -31.4, -64.2)], near), null);
  });
  it("descarta si hay dos lugares cercanos distintos", () => {
    assert.equal(chooseGeocodeMatch("Belgrano 100", [hit("100, Belgrano", -34.61, -58.4), hit("100, Belgrano", -34.68, -58.45)], near), null);
  });
  it("descarta la calle sin altura", () => {
    assert.equal(chooseGeocodeMatch("Thames 856", [hit("Thames, Palermo")], near), null);
  });
});

describe("geocodeOutcome", () => {
  const order = { delivery_address: "Thames 856", geocode_attempts: 0 };
  it("sin resultado cierra los intentos para no reintentar", async () => {
    const out = await geocodeOutcome(order, near, async () => []);
    assert.deepEqual(out, { kind: "rejected", patch: { geocode_attempts: GEOCODE_MAX_ATTEMPTS } });
  });
  it("un error de red suma un intento", async () => {
    const out = await geocodeOutcome(order, near, async () => { throw new Error("429"); });
    assert.deepEqual(out, { kind: "error", patch: { geocode_attempts: 1 } });
  });
  it("ubicado guarda el punto", async () => {
    const out = await geocodeOutcome(order, near, async () => [hit("856, Thames")]);
    assert.equal(out.kind, "located");
  });
});

describe("Worker: geocodeNewOrders", () => {
  const env = { SUPABASE_URL: "https://x.test", SUPABASE_SERVICE_ROLE_KEY: "k" };
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  function mockDb(pending: number) {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/orders?channel")) return new Response(JSON.stringify(Array.from({ length: pending }, (_, i) => ({ id: `o${i}`, delivery_address: "Thames 856", geocode_attempts: 0 }))));
      if (url.includes("global_config")) return new Response("[]");
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    return calls;
  }
  const noSleep = async () => {};

  it("consulta con tope, marca lo resuelto y respeta el segundo entre llamadas", async () => {
    const calls = mockDb(MAX_GEOCODES_PER_RUN);
    let searches = 0;
    let sleeps = 0;
    const out = await geocodeNewOrders(env, 0, { search: async () => { searches += 1; return [hit("856, Thames")]; }, sleep: async () => { sleeps += 1; } });
    assert.equal(out.located, 5);
    assert.equal(searches, 5);
    assert.equal(sleeps, 4);
    assert.ok(calls[0]!.includes(`limit=${MAX_GEOCODES_PER_RUN}`));
    assert.ok(calls.length <= 2 + MAX_GEOCODES_PER_RUN);
  });

  it("corta la tanda al primer error de Nominatim", async () => {
    mockDb(5);
    let searches = 0;
    const out = await geocodeNewOrders(env, 0, { search: async () => { searches += 1; throw new Error("429"); }, sleep: noSleep });
    assert.equal(searches, 1);
    assert.equal(out.errors, 1);
  });

  it("no lanza si la base falla (por ejemplo, sin la migración 027)", async () => {
    globalThis.fetch = (async () => new Response("column does not exist", { status: 400 })) as typeof fetch;
    const out = await geocodeNewOrders(env, 0, { search: async () => [], sleep: noSleep });
    assert.equal(out.errors, 1);
  });

  it("no hace nada si la corrida ya gastó sus subrequests", async () => {
    const calls = mockDb(5);
    await geocodeNewOrders(env, 21, { search: async () => [], sleep: noSleep });
    assert.equal(calls.length, 0);
    assert.equal(geocodeQuota(20), MAX_GEOCODES_PER_RUN);
  });
});

describe("runGeocodeBackfill", () => {
  const orders = [
    { id: "own", client_id: null, delivery_address: "Thames 856", fudo_source: "local", geocode_attempts: 0 },
    { id: "fromClient", client_id: "c1", delivery_address: null, fudo_source: "local", geocode_attempts: 0 },
    { id: "none", client_id: null, delivery_address: null, fudo_source: "local", geocode_attempts: 0 },
    { id: "app", client_id: "c1", delivery_address: null, fudo_source: "pedidosya", geocode_attempts: 0 },
    { id: "done", client_id: null, delivery_address: "Belgrano 1", fudo_source: "local", geocode_attempts: 3 },
  ];

  function deps(search: () => Promise<Array<{ label: string; lat: number; lng: number }>>) {
    const patches: Array<[string, Record<string, unknown>]> = [];
    return {
      patches,
      value: {
        loadOrders: async () => orders,
        loadClientAddresses: async () => new Map([["c1", "Defensa 800"]]),
        patchOrder: async (id: string, patch: Record<string, unknown>) => { patches.push([id, patch]); },
        search,
        sleep: async () => {},
      },
    };
  }

  it("en dry-run cuenta y no escribe ni busca", async () => {
    let searched = false;
    const d = deps(async () => { searched = true; return []; });
    const s = await runGeocodeBackfill(d.value, { apply: false, limit: null, near });
    assert.equal(searched, false);
    assert.equal(d.patches.length, 0);
    assert.equal(s.skippedApps, 1);
    assert.equal(s.addressFromClient, 1);
    assert.equal(s.withoutAddress, 1);
    assert.equal(s.toGeocode, 2);
  });

  it("al aplicar copia la dirección, nunca a las apps, y respeta el límite", async () => {
    const d = deps(async () => [hit("856, Thames 800 Defensa")]);
    await runGeocodeBackfill(d.value, { apply: true, limit: null, near });
    assert.deepEqual(d.patches[1], ["fromClient", { delivery_address: "Defensa 800" }]);
    assert.ok(!d.patches.some(([id]) => id === "app" || id === "none" || id === "done"));

    const limited = deps(async () => []);
    await runGeocodeBackfill(limited.value, { apply: true, limit: 1, near });
    assert.equal(limited.patches.length, 1);
  });
});
