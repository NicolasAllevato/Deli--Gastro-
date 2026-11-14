import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDemoDb } from "./helpers/demo-db.ts";

process.env.COURIER_PIN_SECRET = "test-secret";

const {
  createCourier, changeCourierPin, setCourierActive, findCourierByPin, listCouriers, hashPin, generatePin, pinSchema,
  pinSecret, legacyPinSecrets, DEMO_COURIER_PIN, DEMO_PIN_SECRET, loginPinSchema, legacyPinAllowed, LEGACY_PIN_UNTIL_DEFAULT,
} = await import("../src/lib/courier-pins.ts");

import type { CourierAuth } from "../src/lib/courier-pins.ts";

function fakeAuth() {
  const blocked = new Map<string, boolean>();
  let n = 0;
  const auth: CourierAuth = {
    async createUser() { n += 1; return { id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` }; },
    async setBlocked(id, b) { blocked.set(id, b); return null; },
  };
  return { auth, blocked };
}

describe("PIN de repartidores", () => {
  it("PIN nuevos: 6 números exactos; el ingreso acepta 6 o 4 (transición)", () => {
    assert.ok(pinSchema.safeParse("042012").success);
    for (const bad of ["0420", "123", "12345", "1234567", "12a456", ""]) assert.equal(pinSchema.safeParse(bad).success, false);
    for (let i = 0; i < 20; i++) assert.match(generatePin(), /^\d{6}$/);
    for (const ok of ["0420", "042012"]) assert.ok(loginPinSchema.safeParse(ok).success);
    for (const bad of ["12345", "123", "1234567", "12a4"]) assert.equal(loginPinSchema.safeParse(bad).success, false);
  });

  it("PIN de 4 dígitos: entra hasta el plazo y después no", async () => {
    const { db } = createDemoDb();
    const { auth } = fakeAuth();
    assert.ok((await createCourier(db, auth, { name: "Viejo", pin: "4821" })).ok);
    const antes = new Date("2026-12-31T12:00:00Z");
    const despues = new Date(LEGACY_PIN_UNTIL_DEFAULT);
    assert.equal((await findCourierByPin(db, "4821", antes))?.name, "Viejo");
    assert.equal(await findCourierByPin(db, "4821", despues), null);
    // COURIER_PIN4_UNTIL puede adelantar el plazo, nunca extenderlo.
    assert.equal(legacyPinAllowed(antes, { COURIER_PIN4_UNTIL: "2026-12-01T00:00:00Z" } as unknown as NodeJS.ProcessEnv), false);
    assert.equal(legacyPinAllowed(antes, { COURIER_PIN4_UNTIL: "2030-01-01T00:00:00Z" } as unknown as NodeJS.ProcessEnv), true);
    assert.equal(legacyPinAllowed(despues, { COURIER_PIN4_UNTIL: "2030-01-01T00:00:00Z" } as unknown as NodeJS.ProcessEnv), false);
    assert.equal(legacyPinAllowed(antes, { COURIER_PIN4_UNTIL: "basura" } as unknown as NodeJS.ProcessEnv), true);
  });

  it("los de 6 dígitos entran siempre; formatos inválidos nunca", async () => {
    const { db } = createDemoDb();
    const { auth } = fakeAuth();
    assert.ok((await createCourier(db, auth, { name: "Nuevo", pin: "482100" })).ok);
    assert.equal((await findCourierByPin(db, "482100", new Date("2030-01-01T00:00:00Z")))?.name, "Nuevo");
    assert.equal(await findCourierByPin(db, "48210"), null);
    assert.equal(await findCourierByPin(db, "abcdef"), null);
  });

  it("guarda el hash, nunca el PIN, y lo encuentra para el ingreso", async () => {
    const { db, store } = createDemoDb();
    const { auth } = fakeAuth();
    const res = await createCourier(db, auth, { name: "Juan Pérez", pin: "482155" });
    assert.ok(res.ok);
    const row = store.couriers.find((r) => r.name === "Juan Pérez");
    assert.equal(row?.pin_hash, hashPin("482155"));
    assert.ok(!JSON.stringify(row).includes("482155"));

    assert.equal((await findCourierByPin(db, "482155"))?.name, "Juan Pérez");
    assert.equal(await findCourierByPin(db, "482255"), null);
  });

  it("no deja repetir un PIN y genera uno libre si no se elige", async () => {
    const { db } = createDemoDb();
    const { auth } = fakeAuth();
    assert.ok((await createCourier(db, auth, { name: "Ana", pin: "111155" })).ok);
    const dup = await createCourier(db, auth, { name: "Beto", pin: "111155" });
    assert.deepEqual(dup.ok ? null : dup.status, 409);

    const auto = await createCourier(db, auth, { name: "Beto" });
    assert.ok(auto.ok && /^\d{6}$/.test(auto.pin) && auto.pin !== "111155");
  });

  it("cambiar el PIN invalida el anterior", async () => {
    const { db } = createDemoDb();
    const { auth } = fakeAuth();
    const created = await createCourier(db, auth, { name: "Ana", pin: "246855" });
    assert.ok(created.ok);
    const changed = await changeCourierPin(db, created.courier.userId, "135755");
    assert.ok(changed.ok);
    assert.equal(await findCourierByPin(db, "246855"), null);
    assert.equal((await findCourierByPin(db, "135755"))?.name, "Ana");
    // Su propio PIN actual no cuenta como "en uso".
    assert.ok((await changeCourierPin(db, created.courier.userId, "135755")).ok);
  });

  it("un repartidor desactivado no entra y queda bloqueado en Auth", async () => {
    const { db } = createDemoDb();
    const { auth, blocked } = fakeAuth();
    const created = await createCourier(db, auth, { name: "Ana", pin: "975355" });
    assert.ok(created.ok);
    const off = await setCourierActive(db, auth, created.courier.userId, false);
    assert.ok(off.ok && !off.courier.active);
    assert.equal(blocked.get(created.courier.userId), true);
    assert.equal(await findCourierByPin(db, "975355"), null);

    await setCourierActive(db, auth, created.courier.userId, true);
    assert.equal(blocked.get(created.courier.userId), false);
    assert.equal((await findCourierByPin(db, "975355"))?.name, "Ana");
  });

  it("el repartidor de la demo viene cargado con su PIN", async () => {
    const { db } = createDemoDb();
    const names = (await listCouriers(db)).map((c) => c.name);
    assert.ok(names.includes("Diego Rojas"));
    const { store } = createDemoDb();
    assert.equal(store.couriers[0]?.pin_hash, hashPin(DEMO_COURIER_PIN, DEMO_PIN_SECRET));
  });

  it("PIN guardado con la clave vieja (service role): entra y se re-hashea con la nueva", async () => {
    const prev = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "clave-vieja";
    try {
      const { db, store } = createDemoDb();
      const { auth } = fakeAuth();
      const res = await createCourier(db, auth, { name: "Legado", pin: "731055" });
      assert.ok(res.ok);
      const row = store.couriers.find((r) => r.name === "Legado")!;
      row.pin_hash = hashPin("731055", "clave-vieja"); // como quedó antes de definir COURIER_PIN_SECRET

      assert.equal((await findCourierByPin(db, "731055"))?.name, "Legado");
      assert.equal(row.pin_hash, hashPin("731055"), "migrado a la clave actual");
      assert.equal((await findCourierByPin(db, "731055"))?.name, "Legado", "sigue entrando ya migrado");
      assert.equal(await findCourierByPin(db, "000000"), null);
    } finally {
      if (prev === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = prev;
    }
  });

  it("un PIN con hash viejo cuenta como ocupado para otro repartidor", async () => {
    const prev = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "clave-vieja";
    try {
      const { db, store } = createDemoDb();
      const { auth } = fakeAuth();
      assert.ok((await createCourier(db, auth, { name: "Uno", pin: "555555" })).ok);
      store.couriers.find((r) => r.name === "Uno")!.pin_hash = hashPin("555555", "clave-vieja");
      const dup = await createCourier(db, auth, { name: "Dos", pin: "555555" });
      assert.equal(dup.ok, false);
    } finally {
      if (prev === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = prev;
    }
  });

  it("sin clave propia no hay claves viejas que probar", () => {
    assert.deepEqual(legacyPinSecrets({ SUPABASE_SERVICE_ROLE_KEY: "b" } as unknown as NodeJS.ProcessEnv), []);
    assert.deepEqual(legacyPinSecrets({ COURIER_PIN_SECRET: "a", SUPABASE_SERVICE_ROLE_KEY: "b" } as unknown as NodeJS.ProcessEnv), ["b"]);
    assert.deepEqual(legacyPinSecrets({ COURIER_PIN_SECRET: "a", SUPABASE_SERVICE_ROLE_KEY: "a" } as unknown as NodeJS.ProcessEnv), []);
  });

  it("la clave sale del entorno y no hay clave por defecto fuera de la demo", () => {
    assert.equal(pinSecret({ COURIER_PIN_SECRET: "a", SUPABASE_SERVICE_ROLE_KEY: "b" } as unknown as NodeJS.ProcessEnv), "a");
    assert.equal(pinSecret({ SUPABASE_SERVICE_ROLE_KEY: "b" } as unknown as NodeJS.ProcessEnv), "b");
    assert.equal(pinSecret({ NEXT_PUBLIC_DEMO_MODE: "true" } as unknown as NodeJS.ProcessEnv), DEMO_PIN_SECRET);
    assert.throws(() => pinSecret({} as unknown as NodeJS.ProcessEnv));
    // Vercel puede guardar la clave con BOM: el hash tiene que ser el mismo que sin él.
    assert.equal(pinSecret({ SUPABASE_SERVICE_ROLE_KEY: "﻿b\n" } as unknown as NodeJS.ProcessEnv), "b");
    assert.notEqual(hashPin("1234", "a"), hashPin("1234", "b"));
  });
});
