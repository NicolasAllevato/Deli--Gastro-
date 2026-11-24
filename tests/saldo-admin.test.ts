/** Saldo a favor, administración: migración 0025, vencimiento, carga manual, tope por reclamo y API (solo dueño). */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import "./helpers/alias.ts";
import { createTestDb } from "./helpers/sqlite-d1.ts";

const credit = await import("../src/lib/data/credit-admin.ts");
const { addCredit } = await import("../src/lib/data/credit.ts");
const { resolverReclamo, configReclamos, ReclamoConflictoError } = await import("../src/lib/data/reclamos.ts");
const { readSaldo, saveConfig, adjustSaldo } = await import("../src/lib/credit-admin/api.ts");
const { creditMovementLabel } = await import("../src/lib/credit-view.ts");

const admin = { kind: "admin", userId: "u1" } as const;
const cliente = { kind: "cliente", userId: "u2" } as const;
const DAY = 86_400_000;

function world() {
  const db = createTestDb();
  db.raw.exec("INSERT INTO clients (id, name, phone, phone_digits) VALUES ('c1', 'Ana Pérez', '+54 11 5555-1234', '1155551234'), ('c2', 'Beto', NULL, NULL)");
  return db;
}
const setConfig = (db: ReturnType<typeof world>, key: string, value: number) =>
  db.raw.prepare("INSERT INTO global_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
const saldo = (db: ReturnType<typeof world>, id = "c1") => (db.raw.prepare("SELECT credit_cents AS c FROM clients WHERE id = ?").get(id) as { c: number }).c;
const entry = (key: string, deltaCents: number, motivo: "reclamo" | "compra" | "devolucion" | "ajuste" = "reclamo") => ({
  id: crypto.randomUUID(), clientId: "c1", deltaCents, motivo, idempotencyKey: key,
});

/* ------------------------------------------------------------ migración 0025 */

describe("migración 0025 (vencimiento)", () => {
  const DIR = new URL("../d1/migrations/", import.meta.url);
  const SCHEMA = readFileSync(new URL("../d1/schema/0001_inicial.sql", import.meta.url), "utf8");

  function before() {
    const raw = new DatabaseSync(":memory:");
    raw.exec("PRAGMA foreign_keys = ON;");
    raw.exec(SCHEMA);
    for (const f of readdirSync(DIR).filter((n) => n.endsWith(".sql") && n < "0025_").sort()) raw.exec(readFileSync(new URL(f, DIR), "utf8"));
    return raw;
  }
  const migrate = (raw: DatabaseSync) => raw.exec(readFileSync(new URL("0025_saldo_vencimiento.sql", DIR), "utf8"));

  it("existe una sola 0025", () => {
    assert.equal(readdirSync(DIR).filter((n) => n.startsWith("0025_")).length, 1);
  });

  it("conserva filas y saldos, deja expires_at NULL y sigue sumando con el trigger", () => {
    const raw = before();
    raw.exec("INSERT INTO clients (id, name) VALUES ('c1', 'Ana')");
    raw.exec("INSERT INTO credit_ledger (id, client_id, delta_cents, motivo, description, idempotency_key) VALUES ('l1', 'c1', 500000, 'reclamo', 'x', 'k1'), ('l2', 'c1', -100000, 'compra', NULL, 'k2')");
    const antes = raw.prepare("SELECT credit_cents AS c FROM clients WHERE id = 'c1'").get() as { c: number };
    migrate(raw);
    const filas = raw.prepare("SELECT id, delta_cents, motivo, description, idempotency_key, expires_at FROM credit_ledger ORDER BY id").all().map((r) => ({ ...(r as object) }));
    assert.deepEqual(filas, [
      { id: "l1", delta_cents: 500000, motivo: "reclamo", description: "x", idempotency_key: "k1", expires_at: null },
      { id: "l2", delta_cents: -100000, motivo: "compra", description: null, idempotency_key: "k2", expires_at: null },
    ]);
    assert.equal((raw.prepare("SELECT credit_cents AS c FROM clients WHERE id = 'c1'").get() as { c: number }).c, antes.c);
    assert.equal(antes.c, 400000);
    raw.exec("INSERT INTO credit_ledger (id, client_id, delta_cents, motivo, idempotency_key) VALUES ('l3', 'c1', 100, 'ajuste', 'k3')");
    assert.equal((raw.prepare("SELECT credit_cents AS c FROM clients WHERE id = 'c1'").get() as { c: number }).c, 400100);
    assert.throws(() => raw.exec("INSERT INTO credit_ledger (id, client_id, delta_cents, motivo, idempotency_key) VALUES ('l4', 'c1', -999999, 'compra', 'k4')"), /CHECK constraint/);
    assert.throws(() => raw.exec("INSERT INTO credit_ledger (id, client_id, delta_cents, motivo, idempotency_key) VALUES ('l5', 'c1', 1, 'regalo', 'k5')"), /CHECK constraint/);
    raw.exec("INSERT INTO credit_ledger (id, client_id, delta_cents, motivo, idempotency_key) VALUES ('l6', 'c1', -100, 'vencido', 'vence:l3')");
    assert.equal((raw.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'credit_ledger_v2'").get() as { n: number }).n, 0);
  });

  it("al acreditar guarda created_at + N días; sin configuración o con 0 no vence; los débitos no llevan vencimiento", () => {
    const db = world();
    const ins = db.raw.prepare("INSERT INTO credit_ledger (id, client_id, delta_cents, motivo, idempotency_key, created_at) VALUES (?, 'c1', ?, ?, ?, ?)");
    ins.run("a", 1000, "reclamo", "ka", "2026-01-01T10:00:00.000Z");
    setConfig(db, "saldo_vencimiento_dias", 0);
    ins.run("b", 1000, "reclamo", "kb", "2026-01-01T10:00:00.000Z");
    setConfig(db, "saldo_vencimiento_dias", 30);
    ins.run("c", 1000, "reclamo", "kc", "2026-01-01T10:00:00.000Z");
    ins.run("d", -500, "compra", "kd", "2026-01-02T10:00:00.000Z");
    const exp = Object.fromEntries((db.raw.prepare("SELECT id, expires_at FROM credit_ledger").all() as Array<{ id: string; expires_at: string | null }>).map((r) => [r.id, r.expires_at]));
    assert.deepEqual(exp, { a: null, b: null, c: "2026-01-31T10:00:00.000Z", d: null });
  });
});

/* ------------------------------------------------------------ configuración */

describe("configuración del saldo", () => {
  it("lee 0/0 por defecto, guarda y valida rangos", async () => {
    const db = world();
    assert.deepEqual(await credit.readCreditConfig(db, admin), { topeCents: 0, vencimientoDias: 0 });
    await credit.writeCreditConfig(db, admin, { topeCents: 500_000, vencimientoDias: 60 });
    assert.deepEqual(await credit.readCreditConfig(db, admin), { topeCents: 500_000, vencimientoDias: 60 });
    await assert.rejects(() => credit.writeCreditConfig(db, admin, { topeCents: -1, vencimientoDias: 0 }), /Tope/);
    await assert.rejects(() => credit.writeCreditConfig(db, admin, { topeCents: 0, vencimientoDias: 1.5 }), /Vencimiento/);
    await assert.rejects(() => credit.writeCreditConfig(db, cliente, { topeCents: 0, vencimientoDias: 0 }), /No autorizado/);
    await assert.rejects(() => credit.readCreditConfig(db, cliente), /No autorizado/);
  });
});

/* ------------------------------------------------------------ vencimiento (proceso) */

describe("expireCredits", () => {
  const t0 = new Date("2026-03-01T10:00:00.000Z");
  function withLots() {
    const db = world();
    setConfig(db, "saldo_vencimiento_dias", 30);
    const ins = db.raw.prepare("INSERT INTO credit_ledger (id, client_id, delta_cents, motivo, idempotency_key, created_at) VALUES (?, 'c1', ?, ?, ?, ?)");
    ins.run("a", 1000, "reclamo", "ka", t0.toISOString());
    ins.run("b", 1000, "reclamo", "kb", new Date(t0.getTime() + 10 * DAY).toISOString());
    return { db, ins };
  }

  it("no vence nada antes de tiempo", async () => {
    const { db } = withLots();
    const r = await credit.expireCredits(db, admin, { now: new Date(t0.getTime() + 29 * DAY) });
    assert.deepEqual(r, { clients: 0, expiredLots: 0, expiredCents: 0 });
    assert.equal(saldo(db), 2000);
  });

  it("vence la acreditación vieja, deja la nueva y es idempotente", async () => {
    const { db } = withLots();
    const now = new Date(t0.getTime() + 31 * DAY);
    assert.deepEqual(await credit.expireCredits(db, admin, { now }), { clients: 1, expiredLots: 1, expiredCents: 1000 });
    assert.equal(saldo(db), 1000);
    assert.deepEqual(await credit.expireCredits(db, admin, { now }), { clients: 0, expiredLots: 0, expiredCents: 0 });
    assert.equal(saldo(db), 1000);
    const v = db.raw.prepare("SELECT delta_cents, motivo, idempotency_key FROM credit_ledger WHERE motivo = 'vencido'").all().map((r) => ({ ...(r as object) }));
    assert.deepEqual(v, [{ delta_cents: -1000, motivo: "vencido", idempotency_key: "vence:a" }]);
  });

  it("FIFO: lo gastado se imputa a la acreditación más vieja, así que solo vence el resto de la nueva", async () => {
    const { db, ins } = withLots();
    ins.run("s", -1000, "compra", "ks", new Date(t0.getTime() + 11 * DAY).toISOString());
    await credit.expireCredits(db, admin, { now: new Date(t0.getTime() + 31 * DAY) });
    assert.equal(saldo(db), 1000);
    assert.equal((db.raw.prepare("SELECT count(*) AS n FROM credit_ledger WHERE motivo = 'vencido'").get() as { n: number }).n, 0);
    await credit.expireCredits(db, admin, { now: new Date(t0.getTime() + 41 * DAY) });
    assert.equal(saldo(db), 0);
  });

  it("nunca deja el saldo negativo si se gastó entre medio (no inserta y reintenta después)", async () => {
    const { db, ins } = withLots();
    // Simula un saldo menor al plan: el ledger dice que A está entera pero el saldo ya se gastó por otra vía.
    db.raw.exec("DROP TRIGGER credit_ledger_after_insert");
    ins.run("x", -1500, "compra", "kx", new Date(t0.getTime() + 11 * DAY).toISOString());
    db.raw.exec("UPDATE clients SET credit_cents = 400 WHERE id = 'c1'");
    const r = await credit.expireCredits(db, admin, { now: new Date(t0.getTime() + 31 * DAY) });
    assert.equal(r.expiredLots, 0);
    assert.equal(saldo(db), 400);
  });

  it("una compra concurrente después del vencimiento no puede gastar lo vencido", async () => {
    const { db } = withLots();
    await credit.expireCredits(db, admin, { now: new Date(t0.getTime() + 31 * DAY) });
    await assert.rejects(() => addCredit(db, admin, { ...entry("g1", -1500, "compra") }), /insuficiente/);
    assert.equal(saldo(db), 1000);
  });

  it("procesa por cliente y solo personal", async () => {
    const { db } = withLots();
    db.raw.prepare("INSERT INTO credit_ledger (id, client_id, delta_cents, motivo, idempotency_key, created_at) VALUES ('z', 'c2', 700, 'reclamo', 'kz', ?)").run(t0.toISOString());
    const r = await credit.expireCredits(db, { kind: "system", reason: "test" }, { now: new Date(t0.getTime() + 31 * DAY) });
    assert.deepEqual(r, { clients: 2, expiredLots: 2, expiredCents: 1700 });
    await assert.rejects(() => credit.expireCredits(db, cliente), /No autorizado/);
  });

  it("lo anterior a activar el vencimiento (expires_at NULL) no vence nunca", async () => {
    const db = world();
    db.raw.prepare("INSERT INTO credit_ledger (id, client_id, delta_cents, motivo, idempotency_key, created_at) VALUES ('old', 'c1', 900, 'reclamo', 'ko', '2020-01-01T00:00:00.000Z')").run();
    assert.equal((await credit.expireCredits(db, admin, { now: new Date("2030-01-01T00:00:00.000Z") })).expiredLots, 0);
    assert.equal(saldo(db), 900);
  });
});

/* ------------------------------------------------------------ carga manual */

describe("adjustCredit", () => {
  const input = (over: Partial<Parameters<typeof credit.adjustCredit>[2]> = {}) => ({
    clientId: "c1", deltaCents: 5000, reason: "Regalo de cumpleaños", idempotencyKey: crypto.randomUUID(), adminLabel: "Nico nico@x.com", ...over,
  });

  it("suma con motivo 'ajuste' y deja en la descripción el motivo, quién y cuándo", async () => {
    const db = world();
    const now = new Date("2026-05-05T15:00:00.000Z");
    const r = await credit.adjustCredit(db, admin, input(), now);
    assert.deepEqual(r, { applied: true, balanceCents: 5000 });
    const row = db.raw.prepare("SELECT motivo, description FROM credit_ledger").get() as { motivo: string; description: string };
    assert.equal(row.motivo, "ajuste");
    assert.match(row.description, /Regalo de cumpleaños/);
    assert.match(row.description, /Nico nico@x\.com/);
    assert.match(row.description, /2026-05-05T15:00:00\.000Z/);
  });

  it("reenviar la misma operación no duplica", async () => {
    const db = world();
    const i = input();
    await credit.adjustCredit(db, admin, i);
    const r = await credit.adjustCredit(db, admin, i);
    assert.deepEqual(r, { applied: false, balanceCents: 5000 });
    assert.equal((db.raw.prepare("SELECT count(*) AS n FROM credit_ledger").get() as { n: number }).n, 1);
  });

  it("resta, pero no deja el saldo negativo", async () => {
    const db = world();
    await credit.adjustCredit(db, admin, input());
    assert.equal((await credit.adjustCredit(db, admin, input({ deltaCents: -2000, reason: "Corrección" }))).balanceCents, 3000);
    await assert.rejects(() => credit.adjustCredit(db, admin, input({ deltaCents: -3001 })), (e: Error) => e instanceof credit.AdjustmentError && e.kind === "saldo");
    assert.equal(saldo(db), 3000);
  });

  it("exige motivo, monto válido, cliente existente y personal", async () => {
    const db = world();
    await assert.rejects(() => credit.adjustCredit(db, admin, input({ reason: "   " })), (e: Error) => e instanceof credit.AdjustmentError && e.kind === "motivo");
    await assert.rejects(() => credit.adjustCredit(db, admin, input({ deltaCents: 0 })), (e: Error) => e instanceof credit.AdjustmentError && e.kind === "monto");
    await assert.rejects(() => credit.adjustCredit(db, admin, input({ deltaCents: 1.5 })), (e: Error) => e instanceof credit.AdjustmentError && e.kind === "monto");
    await assert.rejects(() => credit.adjustCredit(db, admin, input({ clientId: "nadie" })), (e: Error) => e instanceof credit.AdjustmentError && e.kind === "cliente");
    await assert.rejects(() => credit.adjustCredit(db, cliente, input()), /No autorizado/);
    assert.equal((db.raw.prepare("SELECT count(*) AS n FROM credit_ledger").get() as { n: number }).n, 0);
  });

  it("antes de restar descuenta lo vencido: no se puede gastar saldo ya vencido", async () => {
    const db = world();
    setConfig(db, "saldo_vencimiento_dias", 10);
    db.raw.prepare("INSERT INTO credit_ledger (id, client_id, delta_cents, motivo, idempotency_key, created_at) VALUES ('a', 'c1', 1000, 'reclamo', 'ka', '2026-01-01T00:00:00.000Z')").run();
    await assert.rejects(
      () => credit.adjustCredit(db, admin, input({ deltaCents: -500 }), new Date("2026-02-01T00:00:00.000Z")),
      (e: Error) => e instanceof credit.AdjustmentError && e.kind === "saldo",
    );
    assert.equal(saldo(db), 0);
  });

  it("una carga positiva hereda el vencimiento configurado", async () => {
    const db = world();
    setConfig(db, "saldo_vencimiento_dias", 15);
    await credit.adjustCredit(db, admin, input());
    const row = db.raw.prepare("SELECT created_at, expires_at FROM credit_ledger").get() as { created_at: string; expires_at: string | null };
    assert.equal(new Date(row.expires_at as string).getTime() - new Date(row.created_at).getTime(), 15 * DAY);
  });
});

/* ------------------------------------------------------------ búsqueda e historial */

describe("búsqueda e historial", () => {
  it("busca por nombre y por teléfono; sin término lista a quienes tienen saldo", async () => {
    const db = world();
    await credit.adjustCredit(db, admin, { clientId: "c1", deltaCents: 700, reason: "ok", idempotencyKey: crypto.randomUUID(), adminLabel: "a" });
    assert.deepEqual((await credit.searchCreditClients(db, admin, "ana")).map((c) => c.id), ["c1"]);
    assert.deepEqual((await credit.searchCreditClients(db, admin, "1155551234")).map((c) => c.id), ["c1"]);
    assert.deepEqual((await credit.searchCreditClients(db, admin, "")).map((c) => [c.id, c.creditCents]), [["c1", 700]]);
    assert.deepEqual(await credit.searchCreditClients(db, admin, "%"), []);
    assert.deepEqual(await credit.searchCreditClients(db, admin, "zzz"), []);
    await assert.rejects(() => credit.searchCreditClients(db, cliente, "ana"), /No autorizado/);
  });

  it("el historial trae vencimiento y aplica lo vencido antes de mostrar el saldo", async () => {
    const db = world();
    setConfig(db, "saldo_vencimiento_dias", 5);
    db.raw.prepare("INSERT INTO credit_ledger (id, client_id, delta_cents, motivo, idempotency_key, created_at) VALUES ('a', 'c1', 1000, 'reclamo', 'ka', '2020-01-01T00:00:00.000Z')").run();
    const h = await credit.creditHistory(db, admin, "c1");
    assert.equal(h?.client.creditCents, 0);
    assert.deepEqual(h?.movements.map((m) => [m.motivo, m.deltaCents]), [["vencido", -1000], ["reclamo", 1000]]);
    assert.equal(h?.movements[1].expiresAt, "2020-01-06T00:00:00.000Z");
    assert.equal(await credit.creditHistory(db, admin, "nadie"), null);
  });
});

/* ------------------------------------------------------------ tope por reclamo */

describe("tope por reclamo", () => {
  function reclamoWorld() {
    const db = world();
    db.raw.prepare("INSERT INTO reclamos (id, numero, conversation_id, client_phone, client_id, motivo) VALUES ('r1', 1, 'cv1', '5491100000000', 'c1', 'llegó frío')").run();
    return db;
  }

  it("sin tope (0) deja acreditar; con tope rechaza lo que lo supera y no toca nada", async () => {
    const db = reclamoWorld();
    setConfig(db, "saldo_tope_reclamo_cents", 500_000);
    await assert.rejects(
      () => resolverReclamo(db, admin, "r1", { resolucion: "ok", compensacion: { tipo: "saldo", valor: 5001 } }),
      (e: Error) => e instanceof ReclamoConflictoError && /tope por reclamo de \$5000/.test(e.message),
    );
    assert.equal(saldo(db), 0);
    assert.equal((db.raw.prepare("SELECT estado FROM reclamos WHERE id = 'r1'").get() as { estado: string }).estado, "abierto");
    const ok = await resolverReclamo(db, admin, "r1", { resolucion: "ok", compensacion: { tipo: "saldo", valor: 5000 } });
    assert.equal(ok.saldoAcreditado, 5000);
    assert.equal(saldo(db), 500_000);
  });

  it("sin configurar no hay tope", async () => {
    const db = reclamoWorld();
    const ok = await resolverReclamo(db, admin, "r1", { resolucion: "ok", compensacion: { tipo: "saldo", valor: 90_000 } });
    assert.equal(ok.saldoAcreditado, 90_000);
  });

  it("el tope no afecta a los puntos y recorta lo que sugiere el agente", async () => {
    const db = reclamoWorld();
    setConfig(db, "saldo_tope_reclamo_cents", 300_000);
    const cfg = await configReclamos(db, admin);
    assert.equal(cfg.saldoTope, 3000);
    assert.equal(cfg.maxSaldo, 3000);
    const ok = await resolverReclamo(db, admin, "r1", { resolucion: "ok", compensacion: { tipo: "puntos", valor: 100 } });
    assert.equal(ok.puntosAcreditados, 100);
  });

  it("un descuento % viejo que se convierte en más que el tope también se rechaza", async () => {
    const db = reclamoWorld();
    db.raw.exec("INSERT INTO orders (id, client_id, items_desc, total_cents) VALUES ('o1', 'c1', 'x', 1000000)");
    db.raw.exec("UPDATE reclamos SET order_id = 'o1' WHERE id = 'r1'");
    setConfig(db, "saldo_tope_reclamo_cents", 100_000);
    await assert.rejects(() => resolverReclamo(db, admin, "r1", { resolucion: "ok", compensacion: { tipo: "descuento", valor: 50 } }), ReclamoConflictoError);
  });
});

/* ------------------------------------------------------------ API */

describe("API de saldo (solo dueño, zod)", () => {
  function deps() {
    const calls: unknown[] = [];
    return {
      calls,
      config: async () => ({ topeCents: 0, vencimientoDias: 0 }),
      setConfig: async (_a: unknown, c: unknown) => (calls.push(["config", c]), c as { topeCents: number; vencimientoDias: number }),
      search: async () => [],
      history: async (_a: unknown, id: string) => (id === "x" ? null : ({ client: { id, name: "A", phone: null, creditCents: 0 }, movements: [] })),
      adjust: async (_a: unknown, i: unknown) => (calls.push(["adjust", i]), { applied: true, balanceCents: 100 }),
    };
  }
  const key = "11111111-1111-4111-8111-111111111111";
  const good = { clientId: "c1", tipo: "restar", pesos: 12.5, motivo: "Corrección", idempotencyKey: key };

  it("rechaza a quien no es admin", async () => {
    const d = deps();
    assert.equal((await readSaldo(cliente, new URLSearchParams(), d as never)).status, 403);
    assert.equal((await saveConfig(cliente, { topePesos: 0, vencimientoDias: 0 }, d as never)).status, 403);
    assert.equal((await adjustSaldo(cliente, "x", good, d as never)).status, 403);
    assert.deepEqual(d.calls, []);
  });

  it("valida la configuración y convierte pesos a centavos", async () => {
    const d = deps();
    assert.equal((await saveConfig(admin, { topePesos: -1, vencimientoDias: 0 }, d as never)).status, 400);
    assert.equal((await saveConfig(admin, { topePesos: 1.234, vencimientoDias: 0 }, d as never)).status, 400);
    assert.equal((await saveConfig(admin, { topePesos: 10, vencimientoDias: 2.5 }, d as never)).status, 400);
    assert.equal((await saveConfig(admin, { topePesos: 10, vencimientoDias: 99999 }, d as never)).status, 400);
    assert.equal((await saveConfig(admin, { topePesos: 10, vencimientoDias: 5, extra: 1 }, d as never)).status, 400);
    assert.equal((await saveConfig(admin, null, d as never)).status, 400);
    assert.equal((await saveConfig(admin, { topePesos: 5000.5, vencimientoDias: 30 }, d as never)).status, 200);
    assert.deepEqual(d.calls, [["config", { topeCents: 500_050, vencimientoDias: 30 }]]);
  });

  it("valida la carga manual: motivo obligatorio, monto > 0, uuid; signo según la operación", async () => {
    const d = deps();
    for (const bad of [
      { ...good, motivo: "" }, { ...good, motivo: "ab" }, { ...good, motivo: "x".repeat(201) }, { ...good, pesos: 0 }, { ...good, pesos: -3 },
      { ...good, tipo: "otro" }, { ...good, idempotencyKey: "no-uuid" }, { ...good, clientId: "a b" }, { ...good, extra: true }, { ...good, pesos: "5" },
    ]) assert.equal((await adjustSaldo(admin, "x", bad, d as never)).status, 400, JSON.stringify(bad));
    assert.deepEqual(d.calls, []);
    assert.equal((await adjustSaldo(admin, "Nico", good, d as never)).status, 200);
    assert.deepEqual(d.calls, [["adjust", { clientId: "c1", deltaCents: -1250, reason: "Corrección", idempotencyKey: key, adminLabel: "Nico" }]]);
  });

  it("traduce los errores de la capa de datos (saldo insuficiente = 409, cliente inexistente = 404)", async () => {
    const d = { ...deps(), adjust: async () => { throw new credit.AdjustmentError("sin saldo", "saldo"); } };
    assert.equal((await adjustSaldo(admin, "x", good, d as never)).status, 409);
    const d2 = { ...deps(), adjust: async () => { throw new credit.AdjustmentError("nadie", "cliente"); } };
    assert.equal((await adjustSaldo(admin, "x", good, d2 as never)).status, 404);
    const d3 = { ...deps(), adjust: async () => { throw new Error("boom interno"); } };
    const r = await adjustSaldo(admin, "x", good, d3 as never);
    assert.equal(r.status, 500);
    assert.doesNotMatch(JSON.stringify(r.body), /boom/);
  });

  it("lectura: lista con config, historial por cliente, 404 y 400", async () => {
    const d = deps();
    assert.equal((await readSaldo(admin, new URLSearchParams("q=ana"), d as never)).status, 200);
    assert.equal((await readSaldo(admin, new URLSearchParams("cliente=c1"), d as never)).status, 200);
    assert.equal((await readSaldo(admin, new URLSearchParams("cliente=x"), d as never)).status, 404);
    assert.equal((await readSaldo(admin, new URLSearchParams("cliente=a%20b"), d as never)).status, 400);
  });
});

describe("portal y permisos", () => {
  it("el portal rotula el vencimiento", () => {
    assert.equal(creditMovementLabel("vencido", null), "Vencido");
  });
});
