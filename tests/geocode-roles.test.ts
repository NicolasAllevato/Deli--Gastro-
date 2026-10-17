import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { geocodeAddress } from "../src/lib/geocode.ts";
import { getUserRole, isAdmin } from "../src/lib/auth/roles.ts";

const NEAR = { lat: -34.6, lng: -58.39 };

function fakeFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(String(url));
    return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("geocodeAddress", () => {
  it("devuelve resultados válidos y descarta los incompletos", async () => {
    const { impl, calls } = fakeFetch([
      { display_name: "Av. Corrientes 1234, CABA", lat: "-34.6037", lon: "-58.3816" },
      { display_name: "Sin coordenadas", lat: "x", lon: "1" },
      { lat: "1", lon: "1" },
    ]);
    const results = await geocodeAddress("Corrientes 1234", NEAR, impl);
    assert.deepEqual(results, [{ label: "Av. Corrientes 1234, CABA", lat: -34.6037, lng: -58.3816 }]);
    assert.match(calls[0]!, /countrycodes=ar/);
    assert.match(calls[0]!, /q=Corrientes\+1234/);
  });

  it("recorta etiquetas largas y tolera respuestas que no son una lista", async () => {
    const long = fakeFetch([{ display_name: "a".repeat(500), lat: 1, lon: 2 }]);
    assert.equal((await geocodeAddress("x", NEAR, long.impl))[0]!.label.length, 200);

    const raro = fakeFetch({ error: "nope" });
    assert.deepEqual(await geocodeAddress("x", NEAR, raro.impl), []);
  });

  it("falla con un error claro si el servicio responde mal", async () => {
    const { impl } = fakeFetch([], { ok: false, status: 503 });
    await assert.rejects(geocodeAddress("x", NEAR, impl), /Nominatim 503/);
  });
});

describe("roles", () => {
  it("lee el rol solo de app_metadata y cae a cliente", () => {
    assert.equal(getUserRole({ app_metadata: { role: "admin" } }), "admin");
    assert.equal(getUserRole({ app_metadata: { role: "repartidor" } }), "repartidor");
    assert.equal(getUserRole({ app_metadata: { role: "superuser" } }), "cliente");
    assert.equal(getUserRole({ app_metadata: {} }), "cliente");
    assert.equal(getUserRole(null), "cliente");
    assert.equal(getUserRole(undefined), "cliente");
  });

  it("ignora un rol puesto en user_metadata (el usuario puede editarlo)", () => {
    const user = { app_metadata: {}, user_metadata: { role: "admin" } };
    assert.equal(getUserRole(user), "cliente");
    assert.equal(isAdmin(user), false);
    assert.equal(isAdmin({ app_metadata: { role: "admin" } }), true);
  });
});
