import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDemoDb } from "./helpers/demo-db.ts";

process.env.COURIER_PIN_SECRET = "test-secret";

const {
  createCourier, changeCourierPin, setCourierActive, findCourierByPin, listCouriers, hashPin, generatePin, pinSchema,
  pinSecret, legacyPinSecrets, DEMO_COURIER_PIN, DEMO_PIN_SECRET,
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
  it("valida 4 números exactos", () => {
    assert.ok(pinSchema.safeParse("0420").success);
    for (const bad of ["123", "12345", "12a4", ""]) assert.equal(pinSchema.safeParse(bad).success, false);
    for (let i = 0; i < 20; i++) assert.match(generatePin(), /^\d{4}$/);
  });

  it("guarda el hash, nunca el PIN, y lo encuentra para el ingreso", async () => {
    const { db, store } = createDemoDb();
    const { auth } = fakeAuth();
    const res = await createCourier(db, auth, { name: "Juan Pérez", pin: "4821" });
    assert.ok(res.ok);
    const row = store.couriers.find((r) => r.name === "Juan Pérez");
    assert.equal(row?.pin_hash, hashPin("4821"));
    assert.ok(!JSON.stringify(row).includes("4821"));

    assert.equal((await findCourierByPin(db, "4821"))?.name, "Juan Pérez");
    assert.equal(await findCourierByPin(db, "4822"), null);
  });

  it("no deja repetir un PIN y genera uno libre si no se elige", async () => {
    const { db } = createDemoDb();
    const { auth } = fakeAuth();
    assert.ok((await createCourier(db, auth, { name: "Ana", pin: "1111" })).ok);
    const dup = await createCourier(db, auth, { name: "Beto", pin: "1111" });
    assert.deepEqual(dup.ok ? null : dup.status, 409);

    const auto = await createCourier(db, auth, { name: "Beto" });
    assert.ok(auto.ok && /^\d{4}$/.test(auto.pin) && auto.pin !== "1111");
  });

  it("cambiar el PIN invalida el anterior", async () => {
    const { db } = createDemoDb();
    const { auth } = fakeAuth();
    const created = await createCourier(db, auth, { name: "Ana", pin: "2468" });
    assert.ok(created.ok);
    const changed = await changeCourierPin(db, created.courier.userId, "1357");
    assert.ok(changed.ok);
    assert.equal(await findCourierByPin(db, "2468"), null);
    assert.equal((await findCourierByPin(db, "1357"))?.name, "Ana");
    // Su propio PIN actual no cuenta como "en uso".
    assert.ok((await changeCourierPin(db, created.courier.userId, "1357")).ok);
  });

  it("un repartidor desactivado no entra y queda bloqueado en Auth", async () => {
    const { db } = createDemoDb();
    const { auth, blocked } = fakeAuth();
    const created = await createCourier(db, auth, { name: "Ana", pin: "9753" });
    assert.ok(created.ok);
    const off = await setCourierActive(db, auth, created.courier.userId, false);
    assert.ok(off.ok && !off.courier.active);
    assert.equal(blocked.get(created.courier.userId), true);
    assert.equal(await findCourierByPin(db, "9753"), null);

    await setCourierActive(db, auth, created.courier.userId, true);
    assert.equal(blocked.get(created.courier.userId), false);
    assert.equal((await findCourierByPin(db, "9753"))?.name, "Ana");
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
      const res = await createCourier(db, auth, { name: "Legado", pin: "7310" });
      assert.ok(res.ok);
      const row = store.couriers.find((r) => r.name === "Legado")!;
      row.pin_hash = hashPin("7310", "clave-vieja"); // como quedó antes de definir COURIER_PIN_SECRET

      assert.equal((await findCourierByPin(db, "7310"))?.name, "Legado");
      assert.equal(row.pin_hash, hashPin("7310"), "migrado a la clave actual");
      assert.equal((await findCourierByPin(db, "7310"))?.name, "Legado", "sigue entrando ya migrado");
      assert.equal(await findCourierByPin(db, "0000"), null);
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
      assert.ok((await createCourier(db, auth, { name: "Uno", pin: "5555" })).ok);
      store.couriers.find((r) => r.name === "Uno")!.pin_hash = hashPin("5555", "clave-vieja");
      const dup = await createCourier(db, auth, { name: "Dos", pin: "5555" });
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
