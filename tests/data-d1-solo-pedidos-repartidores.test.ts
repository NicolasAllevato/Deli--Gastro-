/**
 * D1 como única fuente: pedidos, eventos, habilitaciones, ubicaciones y PIN de repartidores
 * corren con la lógica real de src/lib contra el cliente compatible con supabase-js que
 * ejecuta en D1 (el mismo que usa createAdminClient() con DATA_BACKEND=d1). Cualquier
 * llamada de red (Supabase) hace fallar el test.
 */
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import "./helpers/alias.ts";
import { createTestDb, seed, actors } from "./helpers/sqlite-d1.ts";
import { executeD1Plan, type Plan } from "../src/lib/data/plan-sql.ts";

const { createFakeClient } = await import("../src/lib/demo/fake-client.ts");
const shifts = await import("../src/lib/courier-shifts.ts");
const location = await import("../src/lib/courier-location.ts");
const pins = await import("../src/lib/courier-pins.ts");

const NOW = new Date("2026-11-10T12:00:00Z");

let sqlite: ReturnType<typeof createTestDb>;
let client: ReturnType<typeof createFakeClient>;
const saved = { backend: process.env.DATA_BACKEND, fetch: globalThis.fetch, secret: process.env.COURIER_PIN_SECRET };

beforeEach(() => {
  process.env.DATA_BACKEND = "d1";
  process.env.COURIER_PIN_SECRET = "secreto-de-test-con-largo-suficiente";
  globalThis.fetch = (() => {
    throw new Error("Con DATA_BACKEND=d1 no se sale a la red (Supabase)");
  }) as typeof fetch;
  sqlite = createTestDb();
  seed(sqlite);
  client = createFakeClient({
    execute: (plan) => executeD1Plan(sqlite, actors.system, plan as unknown as Plan),
    getUser: async () => null,
    signIn: async () => ({ error: { message: "no" } }),
    signOut: async () => {},
  });
});

afterEach(() => {
  process.env.DATA_BACKEND = saved.backend;
  process.env.COURIER_PIN_SECRET = saved.secret;
  globalThis.fetch = saved.fetch;
});

describe("habilitaciones diarias (courier_shifts) en D1", () => {
  it("pedir dos veces no cambia el id ni el estado ya decidido", async () => {
    assert.equal(await shifts.requestShift(client, "u-rep1", "Rep Uno", NOW), "pending");
    const first = sqlite.raw.prepare("SELECT id FROM courier_shifts WHERE user_id = 'u-rep1'").get() as { id: string };
    const decided = await shifts.decideShift(client, first.id, "rejected", NOW);
    assert.equal(decided?.status, "rejected");
    // Recargar la página no reabre la solicitud ni le cambia el id que tiene el admin en pantalla.
    assert.equal(await shifts.requestShift(client, "u-rep1", "Otro Nombre", NOW), "rejected");
    const again = sqlite.raw.prepare("SELECT id, courier_name FROM courier_shifts WHERE user_id = 'u-rep1'").all() as { id: string; courier_name: string }[];
    assert.deepEqual(again.map((r) => ({ ...r })), [{ id: first.id, courier_name: "Rep Uno" }]);
  });

  it("aceptar habilita solo ese día", async () => {
    await shifts.requestShift(client, "u-rep2", "Rep Dos", NOW);
    const { id } = sqlite.raw.prepare("SELECT id FROM courier_shifts WHERE user_id = 'u-rep2'").get() as { id: string };
    assert.equal(await shifts.isCourierApproved(client, "Rep Dos", NOW), false);
    await shifts.decideShift(client, id, "approved", NOW);
    assert.equal(await shifts.isCourierApproved(client, "Rep Dos", NOW), true);
    assert.equal(await shifts.isCourierApproved(client, "Rep Dos", new Date("2026-11-12T12:00:00Z")), false);
    // Una solicitud de otro día no se decide con la fecha de hoy.
    assert.equal(await shifts.decideShift(client, id, "rejected", new Date("2026-11-12T12:00:00Z")), null);
  });
});

describe("ubicaciones en D1", () => {
  it("guarda, actualiza y borra la ubicación propia", async () => {
    assert.equal(await location.saveCourierLocation(client, "u-rep1", "Rep Uno", { lat: -34.6, lng: -58.4, accuracy: 10 }), null);
    assert.equal(await location.saveCourierLocation(client, "u-rep1", "Rep Uno", { lat: -34.7, lng: -58.5 }), null);
    const rows = sqlite.raw.prepare("SELECT lat, accuracy_m FROM courier_locations").all() as Record<string, unknown>[];
    assert.deepEqual(rows.map((r) => ({ ...r })), [{ lat: -34.7, accuracy_m: null }]);
    await location.clearCourierLocation(client, "u-rep1");
    assert.equal((sqlite.raw.prepare("SELECT count(*) AS n FROM courier_locations").get() as { n: number }).n, 0);
  });
});

describe("PIN de repartidores en D1", () => {
  it("cambiar el PIN y entrar con él; inactivo no entra; PIN ajeno ocupado → 409", async () => {
    const changed = await pins.changeCourierPin(client, "u-rep1", "246810");
    assert.equal(changed.ok, true);
    assert.equal((await pins.findCourierByPin(client, "246810", NOW))?.userId, "u-rep1");
    assert.equal(await pins.findCourierByPin(client, "999999", NOW), null);
    sqlite.raw.prepare("INSERT INTO couriers (user_id, name, pin_hash) VALUES ('u-rep2', 'Rep Dos', 'otro')").run();
    const taken = await pins.changeCourierPin(client, "u-rep2", "246810");
    assert.deepEqual([taken.ok, !taken.ok && taken.status], [false, 409]);
    const off = await pins.setCourierActive(client, { createUser: async () => ({ id: "x" }), setBlocked: async () => null }, "u-rep1", false);
    assert.equal(off.ok, true);
    assert.equal(await pins.findCourierByPin(client, "246810", NOW), null);
  });
});

describe("pedidos: update condicional + bitácora en D1", () => {
  it("tomar un pedido libre gana uno solo y deja el evento", async () => {
    const take = (name: string) =>
      client.from("orders").update({ courier_name: name }).eq("id", "o-libre").eq("status", "En Preparación").is("courier_name", null).select().maybeSingle();
    const a = await take("Rep Uno");
    const b = await take("Rep Dos");
    assert.equal(a.data?.courier_name, "Rep Uno");
    assert.equal(b.data, null, "el segundo no pisa al primero");
    const ev = await client.from("order_events").insert({ order_id: "o-libre", actor: "repartidor", event: "assigned", detail: "Rep Uno" }).select();
    assert.equal(ev.error, null);
    assert.equal((ev.data ?? []).length, 1);
    assert.ok(typeof (ev.data ?? [])[0]?.id === "string");
  });
});
