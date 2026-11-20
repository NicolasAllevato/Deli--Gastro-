/**
 * Baja de comunicaciones (clients.unsubscribed_at, migración 0021): un cliente que dio de baja su cuenta no recibe nada que no
 * responda a algo que él mismo inicie. Cada envío que puede llegarle se prueba con la lógica real sobre D1 (node:sqlite) y con
 * Meta simulado (fetch): campañas (selección y reenvío), encuestas, avisos de un pedido (transaccionales: siguen) y el ALTA por
 * WhatsApp del Worker (consentimiento explícito: levanta la baja).
 */
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import "./helpers/alias.ts";
import { createTestDb, actors } from "./helpers/sqlite-d1.ts";
import { executeD1Plan, type Plan } from "../src/lib/data/plan-sql.ts";

const { createFakeClient } = await import("../src/lib/demo/fake-client.ts");
const { selectRecipients } = await import("../src/lib/whatsapp/segments.ts");
const campaigns = await import("../src/lib/whatsapp/campaigns.ts");
const notify = await import("../src/lib/whatsapp/notify.ts");
const { d1BotRepo } = await import("../workers/whatsapp-bot/src/repo/d1.ts");
const { createAuth } = await import("../src/lib/data/auth.ts");
const { deleteOwnAccount } = await import("../src/lib/data/data-deletion.ts");

const NOW = new Date("2026-11-10T15:00:00.000Z"); // 12:00 en Buenos Aires: dentro de la franja de encuestas
const AT = "2026-11-09T10:00:00.000Z";

interface Sent { to: string; template: string }

let sqlite: ReturnType<typeof createTestDb>;
let db: ReturnType<typeof createFakeClient>;
let sent: Sent[];
/** Rompe las lecturas de la baja a pedido: la base "se cae" justo en la consulta que mira unsubscribed_at. */
let breakReads = false;
const readsBaja = (plan: { table: string; columns: string; filters: { column: string }[] }) =>
  plan.table === "clients" && (plan.columns.includes("unsubscribed_at") || plan.filters.some((f) => f.column === "unsubscribed_at"));
const saved = { fetch: globalThis.fetch, token: process.env.WHATSAPP_ACCESS_TOKEN, phone: process.env.WHATSAPP_PHONE_NUMBER_ID, backend: process.env.DATA_BACKEND };

beforeEach(() => {
  delete process.env.DATA_BACKEND;
  process.env.WHATSAPP_ACCESS_TOKEN = "token-de-prueba";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "111222333";
  sent = [];
  breakReads = false;
  // Meta simulado: cada mensaje que sale queda anotado (a quién y qué plantilla).
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("/messages") && init?.body) {
      const body = JSON.parse(String(init.body)) as { to: string; template?: { name: string } };
      sent.push({ to: body.to, template: body.template?.name ?? "texto" });
    }
    return new Response(JSON.stringify({ messages: [{ id: `wamid.${sent.length}` }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  sqlite = createTestDb();
  db = createFakeClient({
    execute: async (plan) => {
      if (breakReads && readsBaja(plan as unknown as Parameters<typeof readsBaja>[0])) return { data: null, error: { message: "la base no responde", code: "XX000" }, count: null };
      return executeD1Plan(sqlite, actors.system, plan as unknown as Plan);
    },
    getUser: async () => null,
    signIn: async () => ({ error: { message: "no" } }),
    signOut: async () => {},
  });
});

afterEach(() => {
  globalThis.fetch = saved.fetch;
  for (const [key, value] of [["WHATSAPP_ACCESS_TOKEN", saved.token], ["WHATSAPP_PHONE_NUMBER_ID", saved.phone], ["DATA_BACKEND", saved.backend]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** Cliente con ficha, conversación de WhatsApp (el teléfono verificado) y un pedido entregado hace una hora. */
function seedClient(id: string, phone: string, opts: { optIn?: boolean; unsubscribed?: boolean } = {}) {
  sqlite.raw.prepare(`INSERT INTO clients (id, name, phone, phone_digits, wa_marketing_opt_in, unsubscribed_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, `Cliente ${id}`, `+${phone}`, phone.slice(-10), opts.optIn === false ? 0 : 1, opts.unsubscribed ? AT : null);
  sqlite.raw.prepare(`INSERT INTO wa_conversations (id, client_phone, client_id) VALUES (?, ?, ?)`).run(`w-${id}`, phone, id);
  sqlite.raw.prepare(`INSERT INTO orders (id, client_id, status, items_desc, total_cents, channel, created_at, delivered_at) VALUES (?, ?, 'Finalizados', '1x Muzza', 500000, 'web', ?, ?)`)
    .run(`o-${id}`, id, new Date(NOW.getTime() - 90 * 60_000).toISOString(), new Date(NOW.getTime() - 60 * 60_000).toISOString());
}

const PHONES = { a: "5491111110001", b: "5491111110002", c: "5491111110003" } as const;

describe("campañas de promociones por WhatsApp", () => {
  it("la selección pura deja afuera a quien dio de baja la cuenta aunque su opt-in siga en 1", () => {
    const clients = [
      { id: "a", name: "A", phone: "1", tier: "Bronce", optedIn: true },
      { id: "b", name: "B", phone: "2", tier: "Bronce", optedIn: true, unsubscribed: true },
      { id: "c", name: "C", phone: "3", tier: "Bronce", optedIn: false },
    ];
    assert.deepEqual(selectRecipients(clients, [], { kind: "all" }, NOW).map((r) => r.id), ["a"]);
  });

  it("resolveRecipients (la vista previa y el alta de la campaña) no incluye a los dados de baja", async () => {
    seedClient("a", PHONES.a);
    seedClient("b", PHONES.b, { unsubscribed: true });
    seedClient("c", PHONES.c, { optIn: false });
    const recipients = await campaigns.resolveRecipients(db as never, { kind: "all" });
    assert.deepEqual(recipients.map((r) => r.id), ["a"]);
  });

  it("runCampaign vuelve a mirar la baja: quien la dio después de armada la lista no recibe la promoción", async () => {
    seedClient("a", PHONES.a);
    seedClient("b", PHONES.b);
    const recipients = await campaigns.resolveRecipients(db as never, { kind: "all" });
    assert.deepEqual(recipients.map((r) => r.id).sort(), ["a", "b"]);
    sqlite.raw.prepare(`INSERT INTO wa_campaigns (id, name, segment, message) VALUES ('camp-1', 'Prueba', '{"kind":"all"}', 'Hay promo')`).run();
    sqlite.raw.prepare(`UPDATE clients SET unsubscribed_at = ? WHERE id = 'b'`).run(AT);
    await campaigns.runCampaign(db as never, "camp-1", recipients, "Hay promo");
    assert.deepEqual(sent.map((s) => [s.to, s.template]), [[PHONES.a, "promocion"]]);
    assert.equal((sqlite.raw.prepare(`SELECT sent FROM wa_campaigns WHERE id = 'camp-1'`).get() as { sent: number }).sent, 1);
  });

  it("falla cerrado: si la base no responde al mirar las bajas, la campaña no envía NADA, queda 'failed' y se lanza la excepción", async (t) => {
    t.mock.method(console, "error", () => undefined);
    seedClient("a", PHONES.a);
    seedClient("b", PHONES.b);
    const recipients = await campaigns.resolveRecipients(db as never, { kind: "all" });
    assert.equal(recipients.length, 2);
    sqlite.raw.prepare(`INSERT INTO wa_campaigns (id, name, segment, message) VALUES ('camp-1', 'Prueba', '{"kind":"all"}', 'Hay promo')`).run();
    breakReads = true;
    await assert.rejects(campaigns.runCampaign(db as never, "camp-1", recipients, "Hay promo"), /no se pudo saber quién dio de baja/i);
    assert.equal(sent.length, 0);
    assert.equal((sqlite.raw.prepare(`SELECT status FROM wa_campaigns WHERE id = 'camp-1'`).get() as { status: string }).status, "failed");
    await assert.rejects(campaigns.unsubscribedIds(db as never, ["a"]), /no se pudo saber/i);
  });

  it("falla cerrado también al armar la lista: con la base caída no hay destinatarios (se lanza, no devuelve una lista vacía ni completa)", async () => {
    seedClient("a", PHONES.a);
    breakReads = true;
    await assert.rejects(campaigns.resolveRecipients(db as never, { kind: "all" }), /no se pudieron leer los destinatarios/i);
  });

  it("con más de 90 destinatarios y bajas repartidas entre ellos, ninguno de los dados de baja recibe la promoción", async () => {
    const total = 150;
    const phone = (i: number) => `54911${String(1000000 + i)}`;
    for (let i = 0; i < total; i++) seedClient(`k${i}`, phone(i));
    const recipients = await campaigns.resolveRecipients(db as never, { kind: "all" });
    assert.equal(recipients.length, total);
    // Bajas repartidas a lo largo de toda la lista (cruzan el tope de 90 parámetros por consulta).
    const baja = new Set<number>();
    for (let i = 0; i < total; i += 7) baja.add(i);
    for (const i of baja) sqlite.raw.prepare(`UPDATE clients SET unsubscribed_at = ? WHERE id = ?`).run(AT, `k${i}`);
    assert.ok(baja.size > 20);
    assert.equal((await campaigns.unsubscribedIds(db as never, recipients.map((r) => r.id))).size, baja.size);
    sqlite.raw.prepare(`INSERT INTO wa_campaigns (id, name, segment, message) VALUES ('camp-1', 'Prueba', '{"kind":"all"}', 'Hay promo')`).run();
    await campaigns.runCampaign(db as never, "camp-1", recipients, "Hay promo");
    const reached = new Set(sent.map((x) => x.to));
    for (const i of baja) assert.ok(!reached.has(phone(i)), `k${i} dio de baja la cuenta y recibió la promoción`);
    assert.equal(sent.length, total - baja.size);
    assert.equal((sqlite.raw.prepare(`SELECT sent FROM wa_campaigns WHERE id = 'camp-1'`).get() as { sent: number }).sent, total - baja.size);
  });

  it("unsubscribedIds devuelve solo a los dados de baja y tolera una lista vacía", async () => {
    seedClient("a", PHONES.a);
    seedClient("b", PHONES.b, { unsubscribed: true });
    assert.deepEqual([...(await campaigns.unsubscribedIds(db as never, ["a", "b", "nadie"]))], ["b"]);
    assert.deepEqual([...(await campaigns.unsubscribedIds(db as never, []))], []);
  });
});

describe("encuestas de satisfacción por WhatsApp", () => {
  it("al cliente dado de baja no se le manda ni se le reclama el pedido; al resto sí", async () => {
    seedClient("a", PHONES.a);
    seedClient("b", PHONES.b, { unsubscribed: true });
    const result = await notify.sendDueSurveys(db as never, "https://app.example.test", NOW);
    assert.deepEqual({ sent: result.sent, skipped: result.skipped, failed: result.failed }, { sent: 1, skipped: 1, failed: 0 });
    assert.deepEqual(sent.map((s) => [s.to, s.template]), [[PHONES.a, "encuesta_satisfaccion"]]);
    assert.ok(sqlite.raw.prepare(`SELECT survey_sent_at FROM orders WHERE id = 'o-a'`).get() as object);
    assert.equal((sqlite.raw.prepare(`SELECT survey_sent_at FROM orders WHERE id = 'o-b'`).get() as { survey_sent_at: string | null }).survey_sent_at, null);
  });

  it("si la baja se levanta (ALTA por WhatsApp), la encuesta vuelve a mandarse", async () => {
    seedClient("b", PHONES.b, { unsubscribed: true });
    await notify.sendDueSurveys(db as never, "https://app.example.test", NOW);
    assert.equal(sent.length, 0);
    sqlite.raw.prepare(`UPDATE clients SET unsubscribed_at = NULL WHERE id = 'b'`).run();
    await notify.sendDueSurveys(db as never, "https://app.example.test", NOW);
    assert.deepEqual(sent.map((s) => s.template), ["encuesta_satisfaccion"]);
  });
});

describe("encuestas: falla cerrado", () => {
  it("si no se puede leer la baja del cliente, no se manda ni se reclama la encuesta (se cuenta como falla para que el cron lo vea)", async (t) => {
    t.mock.method(console, "error", () => undefined);
    seedClient("a", PHONES.a);
    breakReads = true;
    const result = await notify.sendDueSurveys(db as never, "https://app.example.test", NOW);
    assert.deepEqual({ sent: result.sent, failed: result.failed }, { sent: 0, failed: 1 });
    assert.equal(sent.length, 0);
    assert.equal((sqlite.raw.prepare(`SELECT survey_sent_at FROM orders WHERE id = 'o-a'`).get() as { survey_sent_at: string | null }).survey_sent_at, null);
  });
});

describe("la baja es por ficha: nunca se mira otra ficha alcanzada por teléfono", () => {
  const SECRET = "secreto-de-prueba-de-32-caracteres-o-mas";

  /** V: la víctima, con su ficha y su conversación de WhatsApp. A: otra persona con cuenta que cargó en su perfil el teléfono de V. */
  async function seedVictimAndSpoofer() {
    seedClient("v", PHONES.a);
    const auth = createAuth({ database: sqlite.raw, secret: SECRET + SECRET, baseURL: "https://opsyndely.la-gambeta.com" });
    const hash = await (await auth.$context).password.hash("clave-segura-123");
    sqlite.raw.prepare(`INSERT INTO "user" (id, name, email, emailVerified, role, createdAt, updatedAt) VALUES ('ua', 'A', 'a@example.test', 1, 'cliente', 'x', 'x')`).run();
    sqlite.raw.prepare(`INSERT INTO "account" (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES ('aa', 'ua', 'credential', 'ua', ?, 'x', 'x')`).run(hash);
    sqlite.raw.prepare(`INSERT INTO clients (id, user_id, name, phone, phone_digits, wa_marketing_opt_in) VALUES ('a', 'ua', 'A', ?, ?, 1)`).run(`+${PHONES.a}`, PHONES.a.slice(-10));
    return auth;
  }

  it("A carga el teléfono de V y se da de baja: la ficha de A queda de baja y las campañas y encuestas le siguen llegando a V", async () => {
    const auth = await seedVictimAndSpoofer();
    const result = await deleteOwnAccount(sqlite, auth, { userId: "ua", password: "clave-segura-123" }, { superOwnerEmail: null, hashSecret: SECRET });
    assert.ok(result.ok, result.ok ? "" : result.error);
    const row = (id: string) => sqlite.raw.prepare(`SELECT unsubscribed_at AS un, wa_marketing_opt_in AS opt FROM clients WHERE id = ?`).get(id) as { un: string | null; opt: number };
    assert.ok(row("a").un, "la ficha de A quedó de baja");
    assert.deepEqual({ ...row("v") }, { un: null, opt: 1 }, "la ficha de V no se tocó");

    const recipients = await campaigns.resolveRecipients(db as never, { kind: "all" });
    assert.deepEqual(recipients.map((r) => r.id), ["v"]);
    sqlite.raw.prepare(`INSERT INTO wa_campaigns (id, name, segment, message) VALUES ('camp-1', 'Prueba', '{"kind":"all"}', 'Hay promo')`).run();
    await campaigns.runCampaign(db as never, "camp-1", recipients, "Hay promo");
    const survey = await notify.sendDueSurveys(db as never, "https://app.example.test", NOW);
    assert.equal(survey.sent, 1);
    assert.deepEqual(sent.map((s) => [s.to, s.template]), [[PHONES.a, "promocion"], [PHONES.a, "encuesta_satisfaccion"]]);
  });

  it("aunque la conversación de V quede enlazada a la ficha de A, solo cuenta la ficha de cada envío: el pedido de otra ficha con ese teléfono sigue recibiendo la encuesta", async () => {
    seedClient("a", PHONES.a, { unsubscribed: true });
    sqlite.raw.prepare(`INSERT INTO clients (id, name, phone, phone_digits, wa_marketing_opt_in) VALUES ('v', 'V', ?, ?, 1)`).run(`+${PHONES.a}`, PHONES.a.slice(-10));
    sqlite.raw.prepare(`INSERT INTO orders (id, client_id, status, items_desc, total_cents, channel, created_at, delivered_at) VALUES ('o-v', 'v', 'Finalizados', '1x Flan', 100, 'web', ?, ?)`)
      .run(new Date(NOW.getTime() - 90 * 60_000).toISOString(), new Date(NOW.getTime() - 60 * 60_000).toISOString());
    sqlite.raw.prepare(`UPDATE orders SET survey_sent_at = ? WHERE id = 'o-a'`).run(AT);
    const result = await notify.sendDueSurveys(db as never, "https://app.example.test", NOW);
    assert.equal(result.sent, 1, "la ficha del pedido (v) no está de baja: es la única que se mira");
  });
});

describe("BAJA entrante por WhatsApp: el número verificado por Meta deja de recibir", () => {
  it("el Worker marca la baja de marketing en las fichas con ese teléfono exacto: sale de las campañas y de las encuestas; ALTA lo revierte", async () => {
    seedClient("a", PHONES.a);
    seedClient("b", PHONES.b);
    const bot = d1BotRepo(sqlite);
    assert.equal(await bot.setMarketingOptIn(PHONES.a, false), 1, "solo la ficha con ese teléfono");
    const row = (id: string) => sqlite.raw.prepare(`SELECT unsubscribed_at AS un, wa_marketing_opt_in AS opt FROM clients WHERE id = ?`).get(id) as { un: string | null; opt: number };
    assert.ok(row("a").un);
    assert.equal(row("a").opt, 0);
    assert.deepEqual({ ...row("b") }, { un: null, opt: 1 }, "otro teléfono: no se toca");

    assert.deepEqual((await campaigns.resolveRecipients(db as never, { kind: "all" })).map((r) => r.id), ["b"]);
    const result = await notify.sendDueSurveys(db as never, "https://app.example.test", NOW);
    assert.deepEqual({ sent: result.sent, skipped: result.skipped }, { sent: 1, skipped: 1 });
    assert.deepEqual(sent.map((s) => s.to), [PHONES.b]);

    // Repetir la baja no cambia la fecha original; el ALTA (consentimiento explícito) la levanta.
    const first = row("a").un;
    await bot.setMarketingOptIn(PHONES.a, false);
    assert.equal(row("a").un, first);
    assert.equal(await bot.setMarketingOptIn(PHONES.a, true), 1);
    assert.deepEqual({ ...row("a") }, { un: null, opt: 1 });
  });
});

describe("avisos de un pedido (transaccionales)", () => {
  it("no dependen de la baja: responden al pedido que el propio cliente hizo (ni siquiera la leen)", async () => {
    seedClient("b", PHONES.b, { unsubscribed: true });
    breakReads = true;
    await notify.notifyOrderEvent(db as never, "o-b", "En Camino");
    assert.deepEqual(sent.map((s) => [s.to, s.template]), [[PHONES.b, "pedido_en_camino"]]);
  });
});

describe("ALTA y BAJA por WhatsApp (Worker whatsapp-bot, D1)", () => {
  it("ALTA es consentimiento explícito: activa el opt-in y levanta la baja de la cuenta; BAJA no cambia la fecha de una baja que ya existía", async () => {
    seedClient("b", PHONES.b, { optIn: false, unsubscribed: true });
    const bot = d1BotRepo(sqlite);
    assert.equal(await bot.setMarketingOptIn(PHONES.b, false), 1);
    const afterBaja = sqlite.raw.prepare(`SELECT wa_marketing_opt_in AS opt, unsubscribed_at AS un FROM clients WHERE id = 'b'`).get() as { opt: number; un: string | null };
    assert.equal(afterBaja.opt, 0);
    assert.equal(afterBaja.un, AT, "la baja ya existente conserva su fecha original");
    assert.equal(await bot.setMarketingOptIn(PHONES.b, true), 1);
    const afterAlta = sqlite.raw.prepare(`SELECT wa_marketing_opt_in AS opt, unsubscribed_at AS un FROM clients WHERE id = 'b'`).get() as { opt: number; un: string | null };
    assert.deepEqual({ ...afterAlta }, { opt: 1, un: null });
  });
});

describe("el resto de los envíos no llega a clientes por esta vía", () => {
  it("el resumen diario y el aviso de reclamos salen solo a los destinatarios que el local cargó en Configuración (personal), no a fichas de clientes", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["../src/lib/daily-summary/send.ts", "../src/lib/reclamos/notify.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      assert.ok(!/from\("clients"\)/.test(source), `${file} no debería elegir destinatarios en la tabla de clientes`);
    }
  });
});
