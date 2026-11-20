/**
 * Eliminación de datos personales sobre el esquema real de D1 (node:sqlite) y Better Auth de verdad:
 * previsualización, ejecución atómica, anonimización de pedidos, idempotencia, registro sin datos en claro,
 * permisos (solo el dueño principal), protecciones (dueño principal, último dueño) y autoservicio con contraseña.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import "./helpers/alias.ts";
import type { Actor } from "../src/lib/data/actor.ts";
import {
  DATA_INVENTORY, DELETION_STEPS, MAX_MATCHED_CLIENTS, CONFIRMATION_MESSAGES, MESSAGES, SELF_MESSAGES, deleteOwnAccount, deleteSubjectData,
  listDeletionRequests, ownAccountEligibility, phoneTail, previewDeletion, subjectHash,
  type DeletionOutcome, type DeletionResult,
} from "../src/lib/data/data-deletion.ts";
import {
  BASE, MARKERS, MARTA, MARTA_CONFIRM, MARTA_MARKERS, OTRO, PASSWORD, PEDRO, SEEDED, SUPER_EMAIL, hashPassword, leftovers, otroSnapshot, rowCounts, seedLookalike, seedStaff, seedWorld, setup, type World,
} from "./helpers/deletion-world.ts";

const asAdmin = (userId: string): Actor => ({ kind: "admin", userId });
const DUENO = asAdmin("dueno");

function expectOk<T>(r: DeletionOutcome<T>): T {
  assert.ok(r.ok, r.ok ? "" : `${r.status} ${r.error}`);
  return r.value;
}
function expectFail<T>(r: DeletionOutcome<T>, status: number): string {
  assert.equal(r.ok, false, "se esperaba un rechazo");
  if (r.ok) throw new Error("unreachable");
  assert.equal(r.status, status, r.error);
  return r.error;
}

async function worldWithData(superOwnerEmail: string | null = SUPER_EMAIL): Promise<World> {
  const world = setup(superOwnerEmail);
  await seedWorld(world);
  return world;
}

const one = (world: World, sql: string, ...params: (string | number | null)[]) => world.db.raw.prepare(sql).get(...params) as Record<string, unknown> | undefined;
const count = (world: World, table: string, where = "1 = 1", ...params: (string | number | null)[]) =>
  (one(world, `SELECT count(*) AS n FROM "${table}" WHERE ${where}`, ...params) as { n: number }).n;
const keyed = (rows: { key: string; count: number }[]) => Object.fromEntries(rows.map((r) => [r.key, r.count]));

const MARTA_PHONE = { phone: "+54 9 11 5555-0101" };
const BOTH_PEOPLE_TABLES = ["user", "clients", "orders", "order_items", "wa_conversations", "wa_messages", "reclamos", "points_ledger", "reviews", "legal_acceptances", "session", "account"];

describe("normalización y hash", () => {
  it("el teléfono cuenta por sus últimos 10 dígitos y exige 8", () => {
    assert.equal(phoneTail("+54 9 11 5555-0101"), "1155550101");
    assert.equal(phoneTail("011 5555-0101"), "1155550101");
    assert.equal(phoneTail("5555-01"), null);
    assert.equal(phoneTail(null), null);
  });
  it("el hash es sha256 hexadecimal de tipo:dato y no contiene el dato", () => {
    const h = subjectHash("phone", "1155550101");
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(h, createHash("sha256").update("phone:1155550101").digest("hex"));
    assert.notEqual(h, subjectHash("email", "1155550101"));
  });
});

describe("inventario", () => {
  it("toda tabla del esquema está clasificada (una tabla nueva sin clasificar rompe esta prueba)", async () => {
    const world = setup();
    const tables = (world.db.raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[]).map((t) => t.name);
    const classified = new Set(DATA_INVENTORY.map((e) => e.table));
    assert.deepEqual(tables.filter((t) => !classified.has(t)), [], "tablas sin clasificar en DATA_INVENTORY");
    assert.deepEqual([...classified].filter((t) => !tables.includes(t)), [], "tablas del inventario que no existen");
    assert.equal(classified.size, DATA_INVENTORY.length, "tablas repetidas en el inventario");
  });

  it("las columnas personales existen en el esquema", () => {
    const world = setup();
    for (const entry of DATA_INVENTORY) {
      const columns = new Set((world.db.raw.prepare(`SELECT name FROM pragma_table_info('${entry.table}')`).all() as { name: string }[]).map((c) => c.name));
      for (const col of entry.personal) assert.ok(columns.has(col), `${entry.table}.${col} no existe`);
    }
  });

  it("cada tabla 'delete' o 'anonymize' tiene un paso del mismo tipo, y cada paso apunta a una tabla del inventario", () => {
    const actionOf = new Map(DATA_INVENTORY.map((e) => [e.table, e.action]));
    for (const entry of DATA_INVENTORY.filter((e) => e.action === "delete" || e.action === "anonymize")) {
      const steps = DELETION_STEPS.filter((s) => s.table === entry.table);
      assert.ok(steps.length > 0, `${entry.table} no tiene paso de borrado`);
      assert.ok(steps.every((s) => s.action === entry.action), `${entry.table}: el paso no coincide con el inventario`);
    }
    for (const step of DELETION_STEPS) assert.ok(["delete", "anonymize"].includes(actionOf.get(step.table) ?? ""), `${step.table} sin clasificar`);
    assert.equal(new Set(DELETION_STEPS.map((s) => s.key)).size, DELETION_STEPS.length, "claves de paso repetidas");
  });

  it("antes de la baja cada columna del inventario tiene datos de Marta o Pedro, y después ninguna los conserva", async () => {
    const world = await worldWithData();
    const personal = DATA_INVENTORY.filter((e) => e.action === "delete" || e.action === "anonymize").flatMap((e) => e.personal.map((col) => [e.table, col] as const));
    const query = (table: string, col: string, marker: string | number) =>
      (world.db.raw.prepare(`SELECT count(*) AS n FROM "${table}" WHERE "${col}" = ?`).get(marker) as { n: number }).n;
    // El hash de la contraseña lo genera Better Auth al sembrar: se lee de la base.
    const seeded: Record<string, string | number> = {
      ...SEEDED,
      "account.password": (one(world, `SELECT password FROM account WHERE id = 'a-marta'`) as { password: string }).password,
    };
    const untested = personal.filter(([t, c]) => !(`${t}.${c}` in seeded));
    assert.deepEqual(untested, [], "columnas del inventario sin sembrar en la prueba");
    for (const [table, col] of personal) assert.ok(query(table, col, seeded[`${table}.${col}`]) >= 1, `${table}.${col}: no se sembró`);

    expectOk(await deleteSubjectData(world.db, DUENO, { ...MARTA_PHONE, ...MARTA_CONFIRM, channel: "email" }, { ...world.opts, files: world.files }));
    expectOk(await deleteSubjectData(world.db, DUENO, { email: PEDRO.email, channel: "email" }, { ...world.opts, files: world.files }));
    for (const [table, col] of personal) assert.equal(query(table, col, seeded[`${table}.${col}`]), 0, `${table}.${col} conserva el dato`);
    assert.deepEqual(leftovers(world), [], "ninguna columna de ninguna tabla conserva un dato de Marta o Pedro");
  });
});

describe("previsualización", () => {
  it("cuenta los registros por tabla, sin datos de la persona", async () => {
    const world = await worldWithData();
    const preview = expectOk(await previewDeletion(world.db, DUENO, MARTA_PHONE, world.opts));
    assert.equal(preview.found, true);
    assert.equal(preview.blocked, null);
    assert.deepEqual(keyed(preview.rows), {
      fudo_writes: 1, order_items: 1, orders: 2, reviews: 1, points_ledger: 1, payment_intents: 1, clients: 2,
      wa_messages: 2, kb_analisis_conversaciones: 1, wa_conversations: 1, reclamos_eventos: 1, reclamos: 1,
      verification_email: 1, fudo_writes_actor: 1, integration_settings: 1, legal_acceptances: 2, session: 1, account: 1, verification_user: 1, user: 1,
    });
    assert.equal(preview.total, 24);
    assert.equal(preview.files, 1);
    assert.deepEqual(preview.accounts, [{ role: "cliente", staffRole: null }]);
    assert.equal(preview.requiresConfirmation, true, "una cuenta y dos fichas con ese teléfono");
    // Los ids (uuid en producción; acá legibles) son lo que el dueño confirma; lo demás no trae datos de la persona.
    const json = JSON.stringify(preview, (key, value) => (key === "id" || key === "linkedUserId" ? undefined : value));
    for (const marker of MARKERS) assert.ok(!json.toLowerCase().includes(marker.toLowerCase()), `la previsualización incluye "${marker}"`);
  });

  it("no cambia nada", async () => {
    const world = await worldWithData();
    const before = rowCounts(world, BOTH_PEOPLE_TABLES);
    expectOk(await previewDeletion(world.db, DUENO, MARTA_PHONE, world.opts));
    assert.deepEqual(rowCounts(world, BOTH_PEOPLE_TABLES), before);
    assert.equal(count(world, "data_deletion_requests"), 0);
  });

  it("por email solo trae lo que tiene ESE email (más lo atado por id): no sigue el teléfono de la cuenta hacia otras fichas ni conversaciones", async () => {
    const world = await worldWithData();
    const byEmail = expectOk(await previewDeletion(world.db, DUENO, { email: "  Marta.PII@Example.test " }, world.opts));
    assert.equal(byEmail.requiresConfirmation, false, "una cuenta y una ficha");
    assert.deepEqual(keyed(byEmail.rows), {
      fudo_writes: 1, order_items: 1, orders: 1, reviews: 1, points_ledger: 1, payment_intents: 1, clients: 1,
      verification_email: 1, fudo_writes_actor: 1, integration_settings: 1, legal_acceptances: 2, session: 1, account: 1, verification_user: 1, user: 1,
    });
    assert.deepEqual(byEmail.matches.users.map((u) => [u.id, u.matchedBy, u.via]), [[MARTA.userId, "email", "direct"]]);
    assert.deepEqual(byEmail.matches.clients.map((c) => [c.id, c.matchedBy, c.via]), [[MARTA.clientId, "email", "direct"]]);
    assert.equal(byEmail.files, 0, "el reclamo cuelga de la ficha de WhatsApp, que no tiene ese email");
  });

  it("por teléfono dice por qué coincidió cada una y qué cuelga por vínculo (link) en vez de por el dato (direct)", async () => {
    const world = await worldWithData();
    world.db.raw.prepare(`INSERT INTO "user" (id, name, email, emailVerified, role, createdAt, updatedAt) VALUES ('u-link', 'Vinculada Sinfono', 'link@example.test', 1, 'cliente', 'x', 'x')`).run();
    world.db.raw.prepare(`INSERT INTO clients (id, user_id, name, phone, phone_digits) VALUES ('c-link', 'u-link', 'Vinculada Sinfono', ?, ?)`).run(MARTA.phone, MARTA.tail);
    const preview = expectOk(await previewDeletion(world.db, DUENO, MARTA_PHONE, world.opts));
    const users = Object.fromEntries(preview.matches.users.map((u) => [u.id, u]));
    const clients = Object.fromEntries(preview.matches.clients.map((c) => [c.id, c]));
    assert.deepEqual([users["u-marta"].matchedBy, users["u-marta"].via], ["phone", "direct"]);
    assert.deepEqual([users["u-link"].matchedBy, users["u-link"].via], ["phone", "link"], "su ficha tiene el teléfono; la cuenta no");
    assert.deepEqual([clients["c-marta"].matchedBy, clients["c-marta"].via], ["phone", "direct"]);
    assert.equal(clients["c-link"].linkedUserId, "u-link");
    assert.equal(users["u-marta"].label, "Marta P. G.", "nombre abreviado: sin apellido completo");
    assert.ok(preview.matches.users.every((u) => u.matchedBy === "phone") && preview.matches.clients.every((c) => c.matchedBy === "phone"));
  });

  it("un teléfono o email sin nada devuelve found=false", async () => {
    const world = await worldWithData();
    const preview = expectOk(await previewDeletion(world.db, DUENO, { phone: "+54 9 11 9999-9999" }, world.opts));
    assert.equal(preview.found, false);
    assert.deepEqual(preview.rows, []);
  });

  it("sin teléfono válido ni email: 400", async () => {
    const world = await worldWithData();
    expectFail(await previewDeletion(world.db, DUENO, { phone: "123" }, world.opts), 400);
    expectFail(await previewDeletion(world.db, DUENO, {}, world.opts), 400);
  });

  it("avisa de los pedidos en curso sin bloquear", async () => {
    const world = await worldWithData();
    world.db.raw.prepare(`UPDATE orders SET status = 'En Camino' WHERE id = 'o-m2'`).run();
    const preview = expectOk(await previewDeletion(world.db, DUENO, MARTA_PHONE, world.opts));
    assert.deepEqual(preview.warnings, [MESSAGES.inProgress]);
    assert.equal(preview.blocked, null);
  });

  it("el teléfono compartido que arrastra demasiadas fichas se frena", async () => {
    const world = await worldWithData();
    const ins = world.db.raw.prepare(`INSERT INTO clients (id, name, phone, phone_digits) VALUES (?, 'X', ?, ?)`);
    for (let i = 0; i < MAX_MATCHED_CLIENTS; i++) ins.run(`c-extra-${i}`, MARTA.phone, MARTA.tail);
    const preview = expectOk(await previewDeletion(world.db, DUENO, MARTA_PHONE, world.opts));
    assert.equal(preview.blocked?.status, 409);
    expectFail(await deleteSubjectData(world.db, DUENO, { ...MARTA_PHONE, ...MARTA_CONFIRM, channel: "email" }, { ...world.opts, files: world.files }), 409);
    assert.equal(count(world, "clients", "id = ?", MARTA.clientId), 1, "no se borró nada");
  });
});

describe("ejecución", () => {
  async function run(world: World) {
    return expectOk(await deleteSubjectData(world.db, DUENO, { ...MARTA_PHONE, ...MARTA_CONFIRM, channel: "email" }, { ...world.opts, files: world.files }));
  }

  it("borra la cuenta, sesiones, credenciales, tokens, mensajes, conversaciones, puntos, reseñas y pagos de Marta", async () => {
    const world = await worldWithData();
    const result = await run(world);
    assert.equal(result.status, "completed");
    assert.equal(result.found, true);
    for (const [table, where] of [
      ["user", "id = 'u-marta'"], ["session", "userId = 'u-marta'"], ["account", "userId = 'u-marta'"], ["verification", "id IN ('v-1', 'v-2')"],
      ["clients", "id IN ('c-marta', 'c-marta-wa')"], ["points_ledger", "client_id = 'c-marta'"], ["reviews", "client_id = 'c-marta'"],
      ["payment_intents", "client_id = 'c-marta'"], ["wa_conversations", "id = 'w-marta'"], ["wa_messages", "conversation_id = 'w-marta'"],
      ["kb_analisis_conversaciones", "conversation_id = 'w-marta'"],
    ] as const) assert.equal(count(world, table, where), 0, `${table} conserva filas de Marta`);
  });

  it("anonimiza los pedidos: id, fecha, montos, medio de pago y estado quedan; nombre, dirección, ubicación y notas no", async () => {
    const world = await worldWithData();
    const before = one(world, `SELECT id, status, items_desc, total_cents, delivery_fee_cents, payment_method, created_at, delivered_at, channel FROM orders WHERE id = 'o-m1'`);
    await run(world);
    const after = one(world, `SELECT * FROM orders WHERE id = 'o-m1'`) as Record<string, unknown>;
    for (const [k, v] of Object.entries(before ?? {})) assert.equal(after[k], v, `orders.${k} cambió`);
    assert.equal(after.client_id, null);
    assert.equal(after.customer_name, "Eliminado");
    for (const col of ["delivery_address", "delivery_lat", "delivery_lng", "delivered_lat", "delivered_lng", "delivered_accuracy_m", "notes"]) assert.equal(after[col], null, `orders.${col}`);
    assert.equal(after.courier_name, PEDRO.name, "el repartidor es otra persona: su nombre sigue hasta que él pida la baja");
    assert.equal(one(world, `SELECT customer_name, total_cents, status FROM orders WHERE id = 'o-m2'`)?.customer_name, "Eliminado");
    assert.equal(one(world, `SELECT total_cents FROM orders WHERE id = 'o-m2'`)?.total_cents, 300000);
    const item = one(world, `SELECT name, qty, unit_price_cents, fudo_comment FROM order_items WHERE id = 'i-m1'`);
    assert.deepEqual({ ...item }, { name: "Muzza", qty: 2, unit_price_cents: 625025, fudo_comment: null });
    assert.equal(one(world, `SELECT payload FROM fudo_writes WHERE id = 'fw-1'`)?.payload, null);
    assert.equal(one(world, `SELECT actor FROM fudo_writes WHERE id = 'fw-2'`)?.actor, "eliminado");
    assert.equal(one(world, `SELECT actor FROM fudo_writes WHERE id = 'fw-1'`)?.actor, "system:orders.patch:admin:dueno", "el actor de otro usuario no se toca");
  });

  it("anonimiza el reclamo y su historial: número, categoría, estado, pedido y compensación quedan", async () => {
    const world = await worldWithData();
    await run(world);
    const r = one(world, `SELECT * FROM reclamos WHERE id = 'r-marta'`) as Record<string, unknown>;
    assert.equal(r.numero, 1);
    assert.equal(r.categoria, "llego_frio");
    assert.equal(r.estado, "resuelto");
    assert.equal(r.order_id, "o-m1");
    assert.equal(r.compensacion_tipo, "puntos");
    assert.equal(r.compensacion_valor, 50);
    assert.equal(r.client_phone, "Eliminado");
    assert.equal(r.motivo, "Eliminado");
    assert.equal(r.client_id, null);
    assert.equal(r.conversation_id, "eliminada-r-marta");
    assert.equal(r.foto_keys, "[]");
    for (const col of ["notas", "resolucion", "mensaje_resolucion", "sugerencia", "sugerencia_error", "notificacion_error"]) assert.equal(r[col], null, `reclamos.${col}`);
    const ev = one(world, `SELECT tipo, autor, detalle FROM reclamos_eventos WHERE id = 're-1'`);
    assert.deepEqual({ ...ev }, { tipo: "creado", autor: "bot", detalle: "Eliminado" });
  });

  it("deja la constancia legal anonimizada: versión y fecha sí; usuario, email, IP y navegador no", async () => {
    const world = await worldWithData();
    const before = world.db.raw.prepare(`SELECT id, document, version, accepted_at, role FROM legal_acceptances WHERE user_id = 'u-marta' ORDER BY id`).all() as Record<string, unknown>[];
    assert.equal(before.length, 2);
    await run(world);
    const after = world.db.raw.prepare(`SELECT id, document, version, accepted_at, role, user_id, email, ip, user_agent FROM legal_acceptances WHERE id IN ('la-1', 'la-2') ORDER BY id`).all() as Record<string, unknown>[];
    assert.equal(after.length, 2, "la constancia sobrevive a la baja de la cuenta");
    for (const row of after) {
      assert.equal(row.user_id, null);
      assert.equal(row.email, null);
      assert.equal(row.ip, null);
      assert.equal(row.user_agent, null);
    }
    assert.deepEqual(after.map(({ id, document, version, accepted_at, role }) => ({ id, document, version, accepted_at, role })), before.map((b) => ({ ...b })));
  });

  it("borra las fotos del reclamo en R2", async () => {
    const world = await worldWithData();
    const result = await run(world);
    assert.deepEqual(world.files.deleted, [MARTA.photo]);
    assert.deepEqual(result.files, { total: 1, failed: 0 });
    assert.equal(result.counts.archivos_r2, 1);
  });

  it("no toca a las demás personas: Beto, el cliente anónimo por canal, el otro repartidor y el aprendizaje del bot", async () => {
    const world = await worldWithData();
    const snapshot = () => Object.fromEntries(
      [
        ["beto-user", `SELECT * FROM "user" WHERE id = 'u-beto'`], ["beto-client", `SELECT * FROM clients WHERE id = 'c-beto'`], ["anon", `SELECT * FROM clients WHERE id = 'c-anon'`],
        ["o-b1", `SELECT * FROM orders WHERE id = 'o-b1'`], ["o-anon", `SELECT * FROM orders WHERE id = 'o-anon'`], ["o-r2", `SELECT * FROM orders WHERE id = 'o-r2'`],
        ["i-b1", `SELECT * FROM order_items WHERE id = 'i-b1'`], ["w-beto", `SELECT * FROM wa_conversations WHERE id = 'w-beto'`], ["wm-b", `SELECT * FROM wa_messages WHERE id = 'wm-b'`],
        ["r-beto", `SELECT * FROM reclamos WHERE id = 'r-beto'`], ["re-b", `SELECT * FROM reclamos_eventos WHERE id = 're-b'`], ["l-b1", `SELECT * FROM points_ledger WHERE id = 'l-b1'`],
        ["r-b1", `SELECT * FROM reviews WHERE id = 'r-b1'`], ["la-b", `SELECT * FROM legal_acceptances WHERE id = 'la-b'`], ["s-beto", `SELECT * FROM session WHERE id = 's-beto'`],
        ["a-beto", `SELECT * FROM account WHERE id = 'a-beto'`], ["rep2", `SELECT * FROM couriers WHERE user_id = 'u-rep2'`], ["loc2", `SELECT * FROM courier_locations WHERE user_id = 'u-rep2'`],
        ["e-r2", `SELECT * FROM order_events WHERE id = 'e-r2'`], ["kbe", `SELECT * FROM kb_errores WHERE id = 'kbe-1'`], ["fw-b", `SELECT * FROM fudo_writes WHERE id = 'fw-b'`],
      ].map(([name, sql]) => [name, JSON.stringify(world.db.raw.prepare(sql).get() ?? null)]),
    );
    const before = snapshot();
    assert.ok(Object.values(before).every((v) => v !== "null"), "los controles tienen que existir");
    await run(world);
    assert.deepEqual(snapshot(), before);
  });

  it("registra el pedido sin datos en claro: hash del teléfono, canal, estado y conteos", async () => {
    const world = await worldWithData();
    const result = await run(world);
    const rows = world.db.raw.prepare(`SELECT * FROM data_deletion_requests`).all() as Record<string, unknown>[];
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.id, result.requestId);
    assert.equal(row.subject_hash, subjectHash("phone", MARTA.tail));
    assert.equal(row.channel, "email");
    assert.equal(row.status, "completed");
    assert.equal(row.performed_by, "dueno");
    assert.ok(row.completed_at && row.requested_at);
    assert.equal(row.error, null);
    assert.deepEqual(JSON.parse(String(row.counts)), result.counts);
    assert.equal(result.counts.orders, 2);
    const flat = JSON.stringify(row).toLowerCase();
    for (const marker of MARKERS) assert.ok(!flat.includes(marker.toLowerCase()), `el registro incluye "${marker}"`);
  });

  it("por email registra el hash del email (nunca el email)", async () => {
    const world = await worldWithData();
    expectOk(await deleteSubjectData(world.db, DUENO, { email: MARTA.email, channel: "admin" }, { ...world.opts, files: world.files }));
    const row = one(world, `SELECT subject_hash, channel FROM data_deletion_requests`);
    assert.equal(row?.subject_hash, subjectHash("email", MARTA.email));
    assert.equal(row?.channel, "admin");
    const json = JSON.stringify(world.db.raw.prepare(`SELECT * FROM data_deletion_requests`).all()).toLowerCase();
    assert.ok(!json.includes(MARTA.email));
  });

  it("es idempotente: repetir no falla, no encuentra nada y no cambia las demás filas", async () => {
    const world = await worldWithData();
    await run(world);
    const before = rowCounts(world, [...BOTH_PEOPLE_TABLES, "data_deletion_requests"]);
    const again = expectOk(await deleteSubjectData(world.db, DUENO, { ...MARTA_PHONE, ...MARTA_CONFIRM, channel: "email" }, { ...world.opts, files: world.files }));
    assert.equal(again.found, false);
    assert.equal(again.total, 0);
    assert.deepEqual(again.counts, {});
    assert.equal(again.status, "completed");
    const after = rowCounts(world, [...BOTH_PEOPLE_TABLES, "data_deletion_requests"]);
    assert.deepEqual({ ...after, data_deletion_requests: 0 }, { ...before, data_deletion_requests: 0 });
    assert.equal(after.data_deletion_requests, before.data_deletion_requests + 1, "cada pedido queda registrado, también el que no encontró nada");
    assert.deepEqual(world.files.deleted, [MARTA.photo], "no vuelve a pedir el archivo");
  });

  it("el cliente anónimo por canal con el mismo teléfono no se toca", async () => {
    const world = await worldWithData();
    world.db.raw.prepare(`UPDATE clients SET phone = ?, phone_digits = ? WHERE id = 'c-anon'`).run(MARTA.phone, MARTA.tail);
    const preview = expectOk(await previewDeletion(world.db, DUENO, MARTA_PHONE, world.opts));
    assert.equal(keyed(preview.rows).clients, 2, "no cuenta al anónimo");
    await run(world);
    assert.equal(count(world, "clients", "id = 'c-anon'"), 1);
    assert.equal(one(world, `SELECT customer_name FROM orders WHERE id = 'o-anon'`)?.customer_name, "PedidosYa");
  });

  it("si el bucket falla, la base queda limpia, el estado es 'partial' y el error anota las claves", async (t) => {
    t.mock.method(console, "error", () => undefined);
    const world = await worldWithData();
    world.files.failWith = new Error("R2 caído");
    const result = expectOk(await deleteSubjectData(world.db, DUENO, { ...MARTA_PHONE, ...MARTA_CONFIRM, channel: "email" }, { ...world.opts, files: world.files }));
    assert.equal(result.status, "partial");
    assert.deepEqual(result.files, { total: 1, failed: 1 });
    assert.equal(count(world, "user", "id = 'u-marta'"), 0);
    const row = one(world, `SELECT status, error FROM data_deletion_requests`);
    assert.equal(row?.status, "partial");
    assert.match(String(row?.error), new RegExp(MARTA.photo));
  });

  it("sin bucket configurado también queda 'partial'", async () => {
    const world = await worldWithData();
    const result = expectOk(await deleteSubjectData(world.db, DUENO, { ...MARTA_PHONE, ...MARTA_CONFIRM, channel: "email" }, { ...world.opts, files: null }));
    assert.equal(result.status, "partial");
  });

  it("nunca borra una clave de R2 que no sea de fotos de reclamos", async () => {
    const world = await worldWithData();
    world.db.raw.prepare(`UPDATE reclamos SET foto_keys = ? WHERE id = 'r-marta'`).run(JSON.stringify([MARTA.photo, "uploads/logo.png", "../otra"]));
    const result = expectOk(await deleteSubjectData(world.db, DUENO, { ...MARTA_PHONE, ...MARTA_CONFIRM, channel: "email" }, { ...world.opts, files: world.files }));
    assert.deepEqual(world.files.deleted, [MARTA.photo]);
    assert.equal(result.status, "partial");
    assert.equal(result.files.failed, 2);
  });

  it("borra a un repartidor: ficha, ubicación, habilitaciones y su nombre en pedidos y bitácora", async () => {
    const world = await worldWithData();
    expectOk(await deleteSubjectData(world.db, DUENO, { email: PEDRO.email, channel: "email" }, { ...world.opts, files: world.files }));
    assert.equal(count(world, "user", "id = 'u-pedro'"), 0);
    for (const t of ["couriers", "courier_locations", "courier_shifts"]) assert.equal(count(world, t, "user_id = 'u-pedro'"), 0, t);
    const o = one(world, `SELECT courier_name, courier_user_id, total_cents, status FROM orders WHERE id = 'o-m1'`);
    assert.deepEqual({ ...o }, { courier_name: "Eliminado", courier_user_id: null, total_cents: 1250050, status: "Finalizados" });
    assert.equal(one(world, `SELECT detail FROM order_events WHERE id = 'e-m2'`)?.detail, "Eliminado");
    assert.equal(one(world, `SELECT actor FROM fudo_writes WHERE id = 'fw-3'`)?.actor, "eliminado");
    assert.equal(count(world, "couriers", "user_id = 'u-rep2'"), 1, "el otro repartidor sigue");
    assert.equal(one(world, `SELECT courier_name FROM orders WHERE id = 'o-r2'`)?.courier_name, "Rep Dos");
    assert.equal(one(world, `SELECT detail FROM order_events WHERE id = 'e-r2'`)?.detail, "Rep Dos");
  });

  it("si una guarda del lote falla, no se aplica NADA (ni el registro como completado)", async (t) => {
    t.mock.method(console, "error", () => undefined);
    const world = await worldWithData();
    // El socio (otro dueño) es el sujeto; justo antes del lote el dueño principal deja de estar activo.
    world.db.raw.prepare(`INSERT INTO clients (id, user_id, name, phone, phone_digits) VALUES ('c-socio', 'socio', 'Socio', '+54 9 11 7777-0303', '1177770303')`).run();
    const racing = { ...world.db, batch: async (s: Parameters<typeof world.db.batch>[0]) => {
      world.db.raw.prepare(`UPDATE "user" SET banned = 1 WHERE id = 'dueno'`).run();
      return world.db.batch(s);
    } };
    const before = rowCounts(world, BOTH_PEOPLE_TABLES);
    const error = expectFail(await deleteSubjectData(racing as World["db"], DUENO, { email: "socio@local.test", channel: "email" }, { ...world.opts, files: world.files }), 409);
    assert.equal(error, MESSAGES.lastOwner);
    assert.deepEqual(rowCounts(world, BOTH_PEOPLE_TABLES), before);
    assert.equal(count(world, "user", "id = 'socio'"), 1);
    assert.equal(one(world, `SELECT status FROM data_deletion_requests`)?.status, "failed");
  });
});

describe("permisos: solo el dueño principal", () => {
  const FORBIDDEN = /dueño principal/;
  const actors: Array<[string, Actor]> = [
    ["otro dueño", asAdmin("socio")], ["gerente", asAdmin("gerente1")], ["cajero", asAdmin("cajero1")],
    ["cliente", { kind: "cliente", userId: "u-marta" }], ["repartidor", { kind: "repartidor", userId: "u-pedro" }],
    ["anónimo", { kind: "anon" }], ["sistema", { kind: "system", reason: "test" }], ["usuario inexistente", asAdmin("nadie")],
  ];

  for (const [label, actor] of actors) {
    it(`${label}: no previsualiza, no ejecuta y no lista (403) y no cambia nada`, async () => {
      const world = await worldWithData();
      const before = rowCounts(world, BOTH_PEOPLE_TABLES);
      await assert.rejects(previewDeletion(world.db, actor, MARTA_PHONE, world.opts), { name: "ForbiddenError", message: FORBIDDEN });
      await assert.rejects(deleteSubjectData(world.db, actor, { ...MARTA_PHONE, ...MARTA_CONFIRM, channel: "email" }, { ...world.opts, files: world.files }), { name: "ForbiddenError" });
      await assert.rejects(listDeletionRequests(world.db, actor, world.opts), { name: "ForbiddenError" });
      assert.deepEqual(rowCounts(world, BOTH_PEOPLE_TABLES), before);
      assert.equal(count(world, "data_deletion_requests"), 0);
      assert.deepEqual(world.files.deleted, []);
    });
  }

  it("sin SUPER_OWNER_EMAIL configurada nadie puede, tampoco el dueño de siempre", async () => {
    const world = await worldWithData(null);
    await assert.rejects(previewDeletion(world.db, DUENO, MARTA_PHONE, world.opts), { name: "ForbiddenError" });
  });

  it("el dueño principal bloqueado (banned) deja de poder", async () => {
    const world = await worldWithData();
    world.db.raw.prepare(`UPDATE "user" SET banned = 1 WHERE id = 'dueno'`).run();
    await assert.rejects(previewDeletion(world.db, DUENO, MARTA_PHONE, world.opts), { name: "ForbiddenError" });
  });

  it("el dueño principal lista los pedidos recientes: sin hash, sin quién lo hizo, sin datos personales", async () => {
    const world = await worldWithData();
    expectOk(await deleteSubjectData(world.db, DUENO, { ...MARTA_PHONE, ...MARTA_CONFIRM, channel: "email" }, { ...world.opts, files: world.files }));
    const list = await listDeletionRequests(world.db, DUENO, world.opts);
    assert.equal(list.length, 1);
    assert.deepEqual(Object.keys(list[0]).sort(), ["channel", "completedAt", "counts", "error", "id", "requestedAt", "status", "total"]);
    assert.equal(list[0].status, "completed");
    assert.equal(list[0].total, 24);
    const json = JSON.stringify(list).toLowerCase();
    for (const marker of MARKERS) assert.ok(!json.includes(marker.toLowerCase()), marker);
    assert.ok(!json.includes(subjectHash("phone", MARTA.tail)));
  });
});

describe("protecciones", () => {
  it("el dueño principal no se puede eliminar (por email): 403 y no se registra ni cambia nada", async () => {
    const world = await worldWithData();
    const before = rowCounts(world, BOTH_PEOPLE_TABLES);
    const preview = expectOk(await previewDeletion(world.db, DUENO, { email: SUPER_EMAIL }, world.opts));
    assert.deepEqual(preview.blocked, { status: 403, reason: MESSAGES.superOwner });
    expectFail(await deleteSubjectData(world.db, DUENO, { email: SUPER_EMAIL, channel: "admin" }, { ...world.opts, files: world.files }), 403);
    assert.deepEqual(rowCounts(world, BOTH_PEOPLE_TABLES), before);
    assert.equal(count(world, "user", "id = 'dueno'"), 1);
    assert.equal(count(world, "data_deletion_requests"), 0);
  });

  it("al dueño principal tampoco se lo borra por teléfono ni si el email viene con mayúsculas", async () => {
    const world = await worldWithData();
    world.db.raw.prepare(`UPDATE "user" SET phone = '+54 9 11 4444-0404' WHERE id = 'dueno'`).run();
    expectFail(await deleteSubjectData(world.db, DUENO, { phone: "1144440404", channel: "admin" }, { ...world.opts, files: world.files }), 403);
    expectFail(await deleteSubjectData(world.db, DUENO, { email: " DUENO@Local.test ", channel: "admin" }, { ...world.opts, files: world.files }), 403);
    assert.equal(count(world, "user", "id = 'dueno'"), 1);
  });

  it("otro dueño sí se puede eliminar mientras quede un dueño activo (el principal)", async () => {
    const world = await worldWithData();
    expectOk(await deleteSubjectData(world.db, DUENO, { email: "socio@local.test", channel: "admin" }, { ...world.opts, files: world.files }));
    assert.equal(count(world, "user", "id = 'socio'"), 0);
    assert.equal(count(world, "user", "id = 'dueno'"), 1);
  });

  it("dos dueños que coinciden con el mismo teléfono: piden confirmación y no se eliminan juntos (409); uno solo sí", async () => {
    const world = await worldWithData();
    world.db.raw.prepare(`UPDATE "user" SET phone = '+54 9 11 8888-0505' WHERE id IN ('socio', 'gerente1')`).run();
    world.db.raw.prepare(`UPDATE "user" SET staff_role = 'admin' WHERE id = 'gerente1'`).run();
    const input = { phone: "1188880505", channel: "admin" as const };
    assert.equal(expectFail(await deleteSubjectData(world.db, DUENO, input, { ...world.opts, files: world.files }), 409), CONFIRMATION_MESSAGES.needed(2, 0));
    const error = expectFail(await deleteSubjectData(world.db, DUENO, { ...input, confirmedUserIds: ["socio", "gerente1"] }, { ...world.opts, files: world.files }), 409);
    assert.equal(error, MESSAGES.manyOwners);
    assert.equal(count(world, "user", "id IN ('socio', 'gerente1')"), 2);
    expectOk(await deleteSubjectData(world.db, DUENO, { ...input, confirmedUserIds: ["socio"] }, { ...world.opts, files: world.files }));
    assert.equal(count(world, "user", "id IN ('socio', 'gerente1')"), 1);
  });

  it("gerentes y cajeros se eliminan sin restricción", async () => {
    const world = await worldWithData();
    expectOk(await deleteSubjectData(world.db, DUENO, { email: "gerente@local.test", channel: "admin" }, { ...world.opts, files: world.files }));
    expectOk(await deleteSubjectData(world.db, DUENO, { email: "cajero@local.test", channel: "admin" }, { ...world.opts, files: world.files }));
    assert.equal(count(world, "user", "id IN ('gerente1', 'cajero1')"), 0);
  });
});

describe("autoservicio", () => {
  async function ownDelete(world: World, userId: string, password: string, now?: Date) {
    return deleteOwnAccount(world.db, world.auth, { userId, password }, { ...world.opts, files: world.files, now: now ? () => now : undefined });
  }

  it("con la contraseña correcta borra la cuenta de inmediato, registra 'autoservicio' y no deja entrar de nuevo", async () => {
    const world = await worldWithData();
    const result = expectOk(await ownDelete(world, "u-marta", PASSWORD));
    assert.equal(result.status, "completed");
    assert.equal(count(world, "user", "id = 'u-marta'"), 0);
    assert.equal(count(world, "session", "userId = 'u-marta'"), 0);
    const row = one(world, `SELECT channel, performed_by, status, subject_hash FROM data_deletion_requests`);
    assert.deepEqual({ ...row }, { channel: "autoservicio", performed_by: "u-marta", status: "completed", subject_hash: subjectHash("email", MARTA.email) });
    const res = await world.auth.handler(new Request(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, "cf-connecting-ip": "10.9.1.1" },
      body: JSON.stringify({ email: MARTA.email, password: PASSWORD }),
    }));
    assert.notEqual(res.status, 200, "la cuenta ya no existe");
  });

  it("con una contraseña incorrecta no borra nada y lo dice", async () => {
    const world = await worldWithData();
    const before = rowCounts(world, BOTH_PEOPLE_TABLES);
    const error = expectFail(await ownDelete(world, "u-marta", "esta-no-es-la-clave"), 400);
    assert.equal(error, SELF_MESSAGES.wrongPassword);
    assert.deepEqual(rowCounts(world, BOTH_PEOPLE_TABLES), before);
    assert.equal(count(world, "data_deletion_requests"), 0);
  });

  it("tras 5 contraseñas incorrectas se bloquea (429), incluso con la correcta, hasta que pasa el bloqueo", async () => {
    const world = await worldWithData();
    const t0 = new Date("2026-11-10T12:00:00.000Z");
    for (let i = 0; i < 5; i++) expectFail(await ownDelete(world, "u-marta", "mal", t0), 400);
    expectFail(await ownDelete(world, "u-marta", PASSWORD, t0), 429);
    assert.equal(count(world, "user", "id = 'u-marta'"), 1);
    // El bloqueo de una cuenta no afecta a las demás ni al tope global del PIN de repartidores.
    assert.equal(count(world, "courier_pin_attempts", "key = '__global__'"), 0);
    const later = new Date(t0.getTime() + 31 * 60_000);
    expectOk(await ownDelete(world, "u-marta", PASSWORD, later));
    assert.equal(count(world, "courier_pin_attempts", "key LIKE 'delete-account:%'"), 0, "se limpia al terminar");
  });

  it("solo borra lo atado a la cuenta: no arrastra conversaciones ni fichas de otro con el mismo teléfono (que Marta pudo escribir a mano)", async () => {
    const world = await worldWithData();
    // La ficha de la cuenta de Beto cambia su teléfono al de Marta (el dato no está verificado)...
    world.db.raw.prepare(`UPDATE clients SET phone = ?, phone_digits = ? WHERE id = 'c-beto'`).run(MARTA.phone, MARTA.tail);
    // ...y Beto elimina SU cuenta: la conversación y las fichas de Marta no se tocan.
    expectOk(await ownDelete(world, "u-beto", PASSWORD));
    assert.equal(count(world, "wa_conversations", "id = 'w-marta'"), 1);
    assert.equal(count(world, "wa_messages", "conversation_id = 'w-marta'"), 2);
    assert.equal(count(world, "clients", "id IN ('c-marta', 'c-marta-wa')"), 2);
    assert.equal(one(world, `SELECT customer_name FROM orders WHERE id = 'o-m1'`)?.customer_name, MARTA.name);
    assert.equal(count(world, "reclamos", "id = 'r-marta' AND motivo <> 'Eliminado'"), 1);
    assert.equal(count(world, "user", "id = 'u-beto'"), 0);
    assert.equal(one(world, `SELECT customer_name FROM orders WHERE id = 'o-b1'`)?.customer_name, "Eliminado");
    assert.equal(count(world, "wa_conversations", "id = 'w-beto'"), 0, "la conversación vinculada a su ficha (client_id) sí se borra");
  });

  it("borra la conversación y el reclamo vinculados a su ficha (client_id)", async () => {
    const world = await worldWithData();
    world.db.raw.prepare(`UPDATE wa_conversations SET client_id = 'c-marta' WHERE id = 'w-marta'`).run();
    world.db.raw.prepare(`UPDATE reclamos SET client_id = 'c-marta' WHERE id = 'r-marta'`).run();
    expectOk(await ownDelete(world, "u-marta", PASSWORD));
    assert.equal(count(world, "wa_conversations", "id = 'w-marta'"), 0);
    assert.equal(one(world, `SELECT motivo FROM reclamos WHERE id = 'r-marta'`)?.motivo, "Eliminado");
    assert.deepEqual(world.files.deleted, [MARTA.photo]);
  });

  it("un pedido en curso lo impide (409) hasta que se entregue o cancele", async () => {
    const world = await worldWithData();
    world.db.raw.prepare(`UPDATE orders SET status = 'En Preparación' WHERE id = 'o-m1'`).run();
    expectFail(await ownDelete(world, "u-marta", PASSWORD), 409);
    assert.equal(count(world, "user", "id = 'u-marta'"), 1);
    world.db.raw.prepare(`UPDATE orders SET status = 'Finalizados' WHERE id = 'o-m1'`).run();
    expectOk(await ownDelete(world, "u-marta", PASSWORD));
  });

  it("el personal del local (gerente, cajero) puede eliminar su cuenta", async () => {
    const world = await worldWithData();
    const hash = await hashPassword(world, PASSWORD);
    for (const id of ["gerente1", "cajero1"]) {
      world.db.raw.prepare(`INSERT INTO "account" (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, 'credential', ?, ?, 'x', 'x')`).run(`a-${id}`, id, id, hash);
      expectOk(await ownDelete(world, id, PASSWORD));
      assert.equal(count(world, "user", "id = ?", id), 0);
    }
  });

  it("el dueño principal NO puede (403), ni con la contraseña correcta", async () => {
    const world = await worldWithData();
    world.db.raw.prepare(`INSERT INTO "account" (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES ('a-dueno', 'dueno', 'credential', 'dueno', ?, 'x', 'x')`).run(await hashPassword(world, PASSWORD));
    assert.equal(expectFail(await ownDelete(world, "dueno", PASSWORD), 403), SELF_MESSAGES.superOwner);
    assert.equal(count(world, "user", "id = 'dueno'"), 1);
    assert.deepEqual(await ownAccountEligibility(world.db, "dueno", world.opts), { canDelete: false, status: 403, reason: SELF_MESSAGES.superOwner });
  });

  it("otro dueño puede mientras haya otro dueño activo; si es el último, no (409)", async () => {
    const world = await worldWithData(null); // sin dueño principal configurado: solo cuenta "último dueño activo"
    const hash = await hashPassword(world, PASSWORD);
    for (const id of ["dueno", "socio"]) {
      world.db.raw.prepare(`INSERT INTO "account" (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, 'credential', ?, ?, 'x', 'x')`).run(`a-${id}`, id, id, hash);
    }
    expectOk(await ownDelete(world, "socio", PASSWORD));
    assert.equal(count(world, "user", "id = 'socio'"), 0);
    assert.equal(expectFail(await ownDelete(world, "dueno", PASSWORD), 409), SELF_MESSAGES.lastOwner);
    assert.equal(count(world, "user", "id = 'dueno'"), 1);
  });

  it("un dueño bloqueado no cuenta como dueño activo: el último activo no puede eliminarse", async () => {
    const world = await worldWithData(null);
    world.db.raw.prepare(`UPDATE "user" SET banned = 1 WHERE id = 'dueno'`).run();
    world.db.raw.prepare(`INSERT INTO "account" (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES ('a-socio', 'socio', 'credential', 'socio', ?, 'x', 'x')`).run(await hashPassword(world, PASSWORD));
    assert.equal(expectFail(await ownDelete(world, "socio", PASSWORD), 409), SELF_MESSAGES.lastOwner);
  });

  it("los repartidores no tienen el botón: 403", async () => {
    const world = await worldWithData();
    assert.equal(expectFail(await ownDelete(world, "u-pedro", PASSWORD), 403), SELF_MESSAGES.courier);
    assert.equal(count(world, "user", "id = 'u-pedro'"), 1);
  });

  it("una cuenta sin contraseña (sin fila de credenciales) no puede por acá", async () => {
    const world = await worldWithData();
    world.db.raw.prepare(`DELETE FROM "account" WHERE userId = 'u-marta'`).run();
    assert.equal(expectFail(await ownDelete(world, "u-marta", PASSWORD), 400), SELF_MESSAGES.noPassword);
  });

  it("un usuario inexistente: 404", async () => {
    const world = await worldWithData();
    expectFail(await ownDelete(world, "nadie", PASSWORD), 404);
  });
});

describe("migración 0019", () => {
  it("legal_acceptances admite user_id NULL (varias constancias anónimas del mismo documento) y conserva la unicidad por usuario", () => {
    const world = setup();
    const ins = world.db.raw.prepare(`INSERT INTO legal_acceptances (id, user_id, document, version) VALUES (?, ?, 'terminos', 'v1')`);
    ins.run("x1", null);
    ins.run("x2", null);
    seedStaff(world);
    ins.run("x3", "dueno");
    assert.throws(() => ins.run("x4", "dueno"), /UNIQUE/);
  });

  it("la baja de un usuario por cualquier otra vía no se lleva la constancia (ON DELETE SET NULL)", () => {
    const world = setup();
    seedStaff(world);
    world.db.raw.prepare(`INSERT INTO legal_acceptances (id, user_id, document, version) VALUES ('x1', 'cajero1', 'terminos', 'v1')`).run();
    world.db.raw.prepare(`DELETE FROM "user" WHERE id = 'cajero1'`).run();
    assert.equal(one(world, `SELECT user_id FROM legal_acceptances WHERE id = 'x1'`)?.user_id, null);
  });

  it("data_deletion_requests rechaza un hash que no sea sha256 y un canal desconocido", () => {
    const world = setup();
    const ins = (hash: string, channel: string) =>
      world.db.raw.prepare(`INSERT INTO data_deletion_requests (id, subject_hash, channel) VALUES (?, ?, ?)`).run(crypto.randomUUID(), hash, channel);
    ins(subjectHash("phone", "1155550101"), "email");
    assert.throws(() => ins("1155550101", "email"), /CHECK/);
    assert.throws(() => ins(subjectHash("phone", "1155550101"), "fax"), /CHECK/);
  });
});
