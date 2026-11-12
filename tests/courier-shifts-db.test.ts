import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import "./helpers/alias.ts";
import { createFakeShiftsDb } from "./helpers/shifts-db.ts";

const { requestShift, listShifts, approvedCourierNames, isCourierApproved, decideShift } = await import(
  "../src/lib/courier-shifts.ts"
);

// 12:00 UTC = 09:00 en Argentina: día de trabajo 2026-11-10. El día anterior es 2026-11-09.
const NOW = new Date("2026-11-10T12:00:00Z");
const TODAY = "2026-11-10";
const YESTERDAY = "2026-11-09";

const shift = (over: Record<string, unknown>) => ({
  id: "s1",
  user_id: "u1",
  courier_name: "Nora",
  shift_day: TODAY,
  status: "approved",
  requested_at: "2026-11-10T11:00:00.000Z",
  decided_at: null,
  ...over,
});

const saved = {
  demo: process.env.NEXT_PUBLIC_DEMO_MODE,
  vercel: process.env.VERCEL_ENV,
};

function setDemo(on: boolean) {
  if (on) process.env.NEXT_PUBLIC_DEMO_MODE = "true";
  else delete process.env.NEXT_PUBLIC_DEMO_MODE;
  delete process.env.VERCEL_ENV;
}

beforeEach(() => setDemo(false));
afterEach(() => {
  for (const [key, value] of [["NEXT_PUBLIC_DEMO_MODE", saved.demo], ["VERCEL_ENV", saved.vercel]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("requestShift: pedir la habilitación del día", () => {
  it("la primera vez crea una solicitud pendiente del día de trabajo", async () => {
    const { db, rows } = createFakeShiftsDb();
    assert.equal(await requestShift(db, "u1", "Nora", NOW), "pending");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, "u1");
    assert.equal(rows[0].courier_name, "Nora");
    assert.equal(rows[0].shift_day, TODAY);
  });

  it("no pisa una fila existente: un rechazado sigue rechazado al volver a pedir", async () => {
    const { db, rows } = createFakeShiftsDb([shift({ status: "rejected" })]);
    assert.equal(await requestShift(db, "u1", "Nora", NOW), "rejected");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "rejected");
  });

  it("tampoco pisa a un habilitado ni cambia el nombre ya guardado", async () => {
    const { db, rows } = createFakeShiftsDb([shift({ status: "approved" })]);
    assert.equal(await requestShift(db, "u1", "Nora Otra", NOW), "approved");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].courier_name, "Nora");
  });

  it("al día siguiente vuelve a pedir: lo de ayer no cuenta", async () => {
    const { db, rows } = createFakeShiftsDb([shift({ shift_day: YESTERDAY, status: "approved" })]);
    assert.equal(await requestShift(db, "u1", "Nora", NOW), "pending");
    assert.equal(rows.length, 2);
  });

  it("otro repartidor tiene su propia solicitud", async () => {
    const { db, rows } = createFakeShiftsDb([shift({ status: "rejected" })]);
    assert.equal(await requestShift(db, "u2", "Beto", NOW), "pending");
    assert.equal(rows.length, 2);
  });

  it("en modo demo queda habilitado sin escribir nada", async () => {
    setDemo(true);
    const { db, rows } = createFakeShiftsDb();
    assert.equal(await requestShift(db, "u1", "Nora", NOW), "approved");
    assert.equal(rows.length, 0);
  });

  it("un error de la base se propaga", async () => {
    const { db } = createFakeShiftsDb([], { failWith: "sin conexión" });
    await assert.rejects(() => requestShift(db, "u1", "Nora", NOW), /sin conexión/);
  });
});

describe("approvedCourierNames: quiénes están habilitados hoy", () => {
  it("devuelve los nombres sin duplicar", async () => {
    const { db } = createFakeShiftsDb([
      shift({ id: "a", user_id: "u1", courier_name: "Nora" }),
      shift({ id: "b", user_id: "u2", courier_name: "Nora" }),
      shift({ id: "c", user_id: "u3", courier_name: "Beto" }),
    ]);
    const names = await approvedCourierNames(db, NOW);
    assert.deepEqual([...(names ?? [])].sort(), ["Beto", "Nora"]);
  });

  it("deja afuera a los pendientes, los rechazados y los de otros días", async () => {
    const { db } = createFakeShiftsDb([
      shift({ id: "a", courier_name: "Nora", status: "approved" }),
      shift({ id: "b", user_id: "u2", courier_name: "Beto", status: "pending" }),
      shift({ id: "c", user_id: "u3", courier_name: "Cata", status: "rejected" }),
      shift({ id: "d", user_id: "u4", courier_name: "Dani", status: "approved", shift_day: YESTERDAY }),
    ]);
    assert.deepEqual(await approvedCourierNames(db, NOW), ["Nora"]);
  });

  it("sin habilitados devuelve una lista vacía, no null", async () => {
    const { db } = createFakeShiftsDb();
    assert.deepEqual(await approvedCourierNames(db, NOW), []);
  });

  it("en modo demo devuelve null: no se filtra", async () => {
    setDemo(true);
    const { db } = createFakeShiftsDb();
    assert.equal(await approvedCourierNames(db, NOW), null);
  });

  it("un error de la base se propaga", async () => {
    const { db } = createFakeShiftsDb([], { failWith: "sin conexión" });
    await assert.rejects(() => approvedCourierNames(db, NOW), /sin conexión/);
  });
});

describe("isCourierApproved: compuerta para tomar o recibir pedidos", () => {
  it("es true solo para un nombre habilitado hoy", async () => {
    const { db } = createFakeShiftsDb([
      shift({ id: "a", courier_name: "Nora", status: "approved" }),
      shift({ id: "b", user_id: "u2", courier_name: "Beto", status: "pending" }),
      shift({ id: "c", user_id: "u3", courier_name: "Cata", status: "rejected" }),
      shift({ id: "d", user_id: "u4", courier_name: "Dani", status: "approved", shift_day: YESTERDAY }),
    ]);
    assert.equal(await isCourierApproved(db, "Nora", NOW), true);
    assert.equal(await isCourierApproved(db, "Beto", NOW), false);
    assert.equal(await isCourierApproved(db, "Cata", NOW), false);
    assert.equal(await isCourierApproved(db, "Dani", NOW), false);
    assert.equal(await isCourierApproved(db, "Desconocido", NOW), false);
  });

  it("deshabilitar a alguien le quita el acceso en el momento", async () => {
    const { db } = createFakeShiftsDb([shift({ status: "approved" })]);
    assert.equal(await isCourierApproved(db, "Nora", NOW), true);
    await decideShift(db, "s1", "rejected", NOW);
    assert.equal(await isCourierApproved(db, "Nora", NOW), false);
  });

  it("en modo demo es true siempre, aunque no haya nadie habilitado", async () => {
    setDemo(true);
    const { db } = createFakeShiftsDb();
    assert.equal(await isCourierApproved(db, "Cualquiera", NOW), true);
  });
});

describe("decideShift: aceptar, rechazar o deshabilitar", () => {
  it("acepta una solicitud pendiente de hoy y registra cuándo se decidió", async () => {
    const { db, rows } = createFakeShiftsDb([shift({ status: "pending" })]);
    const decided = await decideShift(db, "s1", "approved", NOW);
    assert.equal(decided?.status, "approved");
    assert.equal(decided?.courierName, "Nora");
    assert.equal(decided?.decidedAt, NOW.toISOString());
    assert.equal(rows[0].status, "approved");
  });

  it("también deshabilita a alguien ya aceptado", async () => {
    const { db } = createFakeShiftsDb([shift({ status: "approved" })]);
    assert.equal((await decideShift(db, "s1", "rejected", NOW))?.status, "rejected");
  });

  it("devuelve null y no toca nada si la solicitud no es del día actual", async () => {
    const { db, rows } = createFakeShiftsDb([shift({ shift_day: YESTERDAY, status: "pending" })]);
    assert.equal(await decideShift(db, "s1", "approved", NOW), null);
    assert.equal(rows[0].status, "pending");
    assert.equal(rows[0].decided_at, null);
  });

  it("devuelve null si la solicitud no existe", async () => {
    const { db } = createFakeShiftsDb([shift({})]);
    assert.equal(await decideShift(db, "no-existe", "approved", NOW), null);
  });

  it("un error de la base se propaga", async () => {
    const { db } = createFakeShiftsDb([], { failWith: "sin conexión" });
    await assert.rejects(() => decideShift(db, "s1", "approved", NOW), /sin conexión/);
  });
});

describe("listShifts: lista del día", () => {
  it("muestra solo hoy, con los pendientes primero y después por hora de pedido", async () => {
    const { db } = createFakeShiftsDb([
      shift({ id: "a", courier_name: "Nora", status: "approved", requested_at: "2026-11-10T10:00:00.000Z" }),
      shift({ id: "b", user_id: "u2", courier_name: "Beto", status: "rejected", requested_at: "2026-11-10T10:30:00.000Z" }),
      shift({ id: "c", user_id: "u3", courier_name: "Cata", status: "pending", requested_at: "2026-11-10T11:00:00.000Z" }),
      shift({ id: "d", user_id: "u4", courier_name: "Dani", status: "approved", shift_day: YESTERDAY }),
    ]);
    const list = await listShifts(db, NOW);
    assert.deepEqual(list.map((s) => s.courierName), ["Cata", "Nora", "Beto"]);
  });

  it("en modo demo la lista está vacía", async () => {
    setDemo(true);
    const { db } = createFakeShiftsDb([shift({})]);
    assert.deepEqual(await listShifts(db, NOW), []);
  });
});
