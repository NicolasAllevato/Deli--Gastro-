/** Flujo completo de reclamos: bot (abierto/cerrado, fotos, pedido, sin duplicados), datos, API admin, aviso y SLA. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./helpers/alias.ts";
import { createTestDb } from "./helpers/sqlite-d1.ts";
import { processTurn } from "../workers/whatsapp-bot/src/bot/turn.ts";
import { d1BotRepo } from "../workers/whatsapp-bot/src/repo/d1.ts";
import { complaintReply, orderDayLabel } from "../workers/whatsapp-bot/src/bot/complaints.ts";
import { combineBatch, emptyBatch, addMessage } from "../workers/whatsapp-bot/src/batching.ts";
import type { OrdersClient, ReclamoRequest } from "../workers/whatsapp-bot/src/orders/client.ts";
import { parseWebhook } from "../src/lib/whatsapp/payload.ts";
import { categorizarReclamo, esQueja } from "../src/lib/reclamos/categoria.ts";
import { slaCorte } from "../src/lib/reclamos/sla.ts";
import { mensajeResolucion, dentroDeVentana } from "../src/lib/reclamos/mensajes.ts";
import { avisarReclamoNuevo, renderAviso } from "../src/lib/reclamos/notify.ts";
import type { ReclamosApiDeps } from "../src/lib/reclamos/api.ts";
import { reclamosPorAvisar, textoAviso, leerVistos, marcarVisto, SEEN_KEY } from "../src/lib/reclamos/aviso-panel.ts";
import { SCHEMAS } from "../src/lib/bot-internal/schemas.ts";
import {
  agregarNotaReclamo, cambiarEstadoReclamo, contextoAvisoReclamo, getReclamo, listReclamos, marcarReclamoNotificado,
  reclamosPorCategoria, resolverReclamo, resumenReclamos,
} from "../src/lib/data/reclamos.ts";

// api.ts usa `@/lib/data`: se importa después de registrar el alias.
const { accionReclamo, listarReclamos } = await import("../src/lib/reclamos/api.ts");

const PHONE = "5491170000001";
const admin = { kind: "admin", userId: "u1" } as const;
const OPEN = { horario_apertura: "00:00", horario_cierre: "23:59" };
const CLOSED = { horario_apertura: "03:00", horario_cierre: "03:01" };

function setup(hours: Record<string, string>, orderMinutesAgo: number | null = 60) {
  const db = createTestDb();
  const cfg = db.raw.prepare("INSERT INTO global_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value");
  for (const [k, v] of Object.entries({ agente_activo: true, ...hours })) cfg.run(k, JSON.stringify(v));
  cfg.run("resumen_diario", JSON.stringify({ activo: true, hora: "23:30", destinatarios: [{ id: "1", nombre: "Dueño", email: "duenio@local.test", telefono: "", activo: true }] }));
  db.raw.exec("INSERT INTO clients (id, name, phone, phone_digits) VALUES ('cl1', 'Tata', '5491170000001', '1170000001')");
  db.raw.exec(`INSERT INTO wa_conversations (id, client_phone, contact_name, client_id, last_inbound_at) VALUES ('c1', '${PHONE}', 'Tata', 'cl1', '${new Date().toISOString()}')`);
  if (orderMinutesAgo !== null) {
    db.raw
      .prepare("INSERT INTO orders (id, client_id, items_desc, total_cents, created_at) VALUES ('abcd1234-0000-4000-8000-000000000001', 'cl1', '1x Muzza', 1250000, ?)")
      .run(new Date(Date.now() - orderMinutesAgo * 60_000).toISOString());
  }
  const repo = { ...d1BotRepo(db), lastOutboundAt: async () => new Date() };
  const sent: string[] = [];
  const notified: ReclamoRequest[] = [];
  const stored: string[] = [];
  const orders = { reclamo: async (b: ReclamoRequest) => { notified.push(b); return { ok: true as const, status: 200, data: { ok: true } }; } } as unknown as OrdersClient;
  let n = 0;
  const turn = (text: string, intent = "humano", images: { wamid: string; mediaId: string }[] = []) => {
    const wamid = `in-${++n}`;
    db.raw.prepare("INSERT INTO wa_messages (id, conversation_id, wamid, direction, type, body) VALUES (?, 'c1', ?, 'in', 'text', ?)").run(crypto.randomUUID(), wamid, text);
    const run = async (_m: string, input: Record<string, unknown>) =>
      "response_format" in input ? { response: JSON.stringify({ intent, confidence: 0.95 }) } : { response: "¿Algo más?" };
    return processTurn(
      { phone: PHONE, text, wamids: [wamid], audios: [], images, receivedAt: 0 },
      {
        repo, run, transcribe: async () => null, appUrl: "https://opsyndely.la-gambeta.com", orders, log: () => {},
        send: async (_p, t) => { sent.push(t); return `o-${sent.length}`; },
        storePhoto: async (ticketId, mediaId) => { const k = `reclamos/${ticketId}/${mediaId}.jpg`; stored.push(k); return k; },
      },
    );
  };
  const takeover = () => (db.raw.prepare("SELECT human_takeover AS t FROM wa_conversations WHERE id = 'c1'").get() as { t: number }).t === 1;
  const rows = () => db.raw.prepare("SELECT * FROM reclamos").all() as Array<Record<string, string | number | null>>;
  return { db, repo, turn, sent, notified, stored, takeover, rows };
}

describe("bot: reclamos", () => {
  it("local abierto: crea el ticket, ofrece el pedido reciente, pide foto y deriva a una persona", async () => {
    const w = setup(OPEN);
    assert.equal(await w.turn("llegó todo frío, un desastre"), "ticket");
    const [r] = w.rows();
    assert.equal(r.numero, 1);
    assert.equal(r.categoria, "llego_frio");
    assert.equal(r.order_id, "abcd1234-0000-4000-8000-000000000001");
    assert.equal(w.takeover(), true);
    assert.match(w.sent[0], /¿Es por tu pedido #ABCD1234 de (hoy|ayer)\?/);
    assert.match(w.sent[0], /mandame una foto del pedido/);
    assert.match(w.sent[0], /Ya lo registramos \(reclamo #1\)\. Te escribe alguien del local\./);
    assert.equal(w.notified.length, 1);
    assert.equal(w.notified[0].reclamoId, r.id);
  });

  it("local cerrado: ticket sin derivar y aviso de cuándo abre", async () => {
    const w = setup(CLOSED);
    assert.equal(await w.turn("me cobraron de más"), "ticket");
    assert.equal(w.takeover(), false);
    assert.equal(w.rows()[0].categoria, "cobro");
    assert.match(w.sent[0], /Lo registramos \(reclamo #1\)\. Te contactamos cuando abramos a las 03:00\./);
  });

  it("sin duplicados: la respuesta y las fotos se suman al MISMO reclamo y el aviso al local sale una vez", async () => {
    const w = setup(CLOSED);
    await w.turn("quiero hacer un reclamo");
    assert.match(w.sent[0], /Contame brevemente qué pasó/);
    assert.equal(await w.turn("sí, ese pedido, faltó la coca", "otro"), "ticket");
    assert.equal(await w.turn("[foto]", "otro", [{ wamid: "img1", mediaId: "m1" }]), "ticket");
    assert.equal(await w.turn("me quiero quejar otra vez, horrible"), "ticket");
    const rows = w.rows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].categoria, "faltante");
    assert.match(String(rows[0].motivo), /faltó la coca/);
    assert.deepEqual(JSON.parse(String(rows[0].foto_keys)), [w.stored[0]]);
    assert.match(w.sent[2], /Gracias por la foto! La sumé al reclamo #1/);
    assert.equal(w.notified.length, 1);
  });

  it("una foto que llega con una persona a cargo se guarda en silencio", async () => {
    const w = setup(OPEN);
    await w.turn("llegó equivocado el pedido");
    assert.equal(w.takeover(), true);
    assert.equal(await w.turn("[foto]", "otro", [{ wamid: "img2", mediaId: "m2" }]), "takeover");
    assert.equal(w.sent.length, 1);
    assert.equal(JSON.parse(String(w.rows()[0].foto_keys)).length, 1);
  });

  it("pedido de más de 48 h no se vincula; pedir una persona sin queja (abierto) solo deriva", async () => {
    const w = setup(OPEN, 60 * 72);
    await w.turn("tardó una hora y media");
    assert.equal(w.rows()[0].order_id, null);
    assert.doesNotMatch(w.sent[0], /¿Es por tu pedido/);
    const v = setup(OPEN);
    assert.equal(await v.turn("quiero hablar con alguien"), "answered");
    assert.equal(v.rows().length, 0);
    assert.equal(v.takeover(), true);
  });

  it("textos y piezas puras", () => {
    assert.equal(categorizarReclamo("Llegó FRÍA la pizza"), "llego_frio");
    assert.equal(categorizarReclamo("hace 2 horas que espero"), "demora");
    assert.equal(categorizarReclamo("me trajeron otro pedido, está equivocado"), "pedido_equivocado");
    assert.equal(categorizarReclamo("el repartidor fue un maleducado"), "atencion");
    assert.equal(esQueja("quiero hablar con alguien"), false);
    assert.equal(esQueja("quiero hacer un reclamo"), true);
    const now = new Date("2026-11-18T15:00:00Z");
    assert.equal(orderDayLabel(new Date("2026-11-17T20:00:00Z"), now), "de ayer");
    assert.equal(orderDayLabel(new Date("2026-11-18T13:00:00Z"), now), "de hoy");
    assert.doesNotMatch(complaintReply({ numero: 3, shopOpen: true, openAt: "11:00", order: null, askDetail: false, askPhoto: false }), /foto|pedido #/);
  });

  it("las fotos de WhatsApp se leen del webhook y se apilan aparte", () => {
    const [msg] = parseWebhook({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "1" }, messages: [{ id: "w1", from: PHONE, type: "image", image: { id: "m9", mime_type: "image/jpeg", caption: "así llegó" } }] } }] }] });
    assert.deepEqual((msg as { content: unknown }).content, { type: "image", mediaId: "m9", mimeType: "image/jpeg", caption: "así llegó" });
    const batch = addMessage(addMessage(emptyBatch(), { wamid: "a", text: "llegó frío", at: 1, kind: "text" }), { wamid: "b", text: "", at: 2, kind: "image", mediaId: "m9" });
    const t = combineBatch(batch);
    assert.equal(t.text, "llegó frío\n[foto]");
    assert.deepEqual(t.images, [{ wamid: "b", mediaId: "m9" }]);
    assert.deepEqual(t.audios, []);
  });
});

async function ticket(hours = OPEN) {
  const w = setup(hours);
  await w.turn("llegó frío");
  return { ...w, id: String(w.rows()[0].id) };
}

describe("datos: reclamos", () => {
  it("lista con filtros, toma, nota e historial", async () => {
    const w = await ticket();
    assert.equal((await listReclamos(w.db, admin, { estado: "abierto" })).length, 1);
    assert.equal((await listReclamos(w.db, admin, { categoria: "demora" })).length, 0);
    assert.equal((await listReclamos(w.db, admin, { desde: "2000-01-01", hasta: "2000-01-02" })).length, 0);
    await cambiarEstadoReclamo(w.db, admin, w.id, "tomar");
    await assert.rejects(() => cambiarEstadoReclamo(w.db, admin, w.id, "tomar"), /ya no está abierto/);
    await agregarNotaReclamo(w.db, admin, w.id, "Llamamos al cliente");
    const d = await getReclamo(w.db, admin, w.id);
    assert.equal(d?.estado, "en_curso");
    assert.equal(d?.notas, "Llamamos al cliente");
    assert.equal(d?.pedido?.items_desc, "1x Muzza");
    assert.deepEqual(d?.eventos.map((e) => e.tipo), ["creado", "estado", "nota"]);
    await assert.rejects(() => listReclamos(w.db, { kind: "cliente", userId: "x" }), /No autorizado/);
  });

  it("resolver con PUNTOS acredita en el ledger una sola vez", async () => {
    const w = await ticket();
    const { puntosAcreditados } = await resolverReclamo(w.db, admin, w.id, { resolucion: "Te reenviamos la pizza", compensacion: { tipo: "puntos", valor: 150 } });
    assert.equal(puntosAcreditados, 150);
    const c = w.db.raw.prepare("SELECT total_points AS p FROM clients WHERE id = 'cl1'").get() as { p: number };
    assert.equal(c.p, 150);
    const ledger = w.db.raw.prepare("SELECT description, idempotency_key FROM points_ledger").all() as Array<{ description: string; idempotency_key: string }>;
    assert.deepEqual(ledger.map((l) => ({ ...l })), [{ description: "Compensación por reclamo #1", idempotency_key: `reclamo:${w.id}` }]);
    await assert.rejects(() => resolverReclamo(w.db, admin, w.id, { resolucion: "otra vez" }), /ya está resuelto/);
    const d = await getReclamo(w.db, admin, w.id);
    assert.deepEqual([d?.estado, d?.compensacion_tipo, d?.compensacion_valor], ["resuelto", "puntos", 150]);
  });

  it("DESCUENTO se registra (sin cupón automático) y los conteos por categoría y SLA funcionan", async () => {
    const w = await ticket();
    await resolverReclamo(w.db, admin, w.id, { resolucion: "Disculpas", compensacion: { tipo: "descuento", valor: 15 } });
    assert.equal((w.db.raw.prepare("SELECT count(*) AS n FROM points_ledger").get() as { n: number }).n, 0);
    const cats = await reclamosPorCategoria(w.db, admin, "2000-01-01T00:00:00Z");
    assert.equal(cats.llego_frio, 1);
    assert.equal(cats.demora, 0);
    const v = await ticket();
    const resumen = await resumenReclamos(v.db, admin, null);
    assert.deepEqual([resumen.abiertos, resumen.enCurso, resumen.vencidos], [1, 0, 0]);
    assert.deepEqual(resumen.recientes.map((r) => [r.numero, r.categoria, r.client_name]), [[1, "llego_frio", "Tata"]]);
    assert.equal((await resumenReclamos(v.db, admin, new Date(Date.now() + 60_000).toISOString())).vencidos, 1);
  });

  it("aviso: contexto con destinatarios del resumen diario, marca única", async () => {
    const w = await ticket();
    const ctx = await contextoAvisoReclamo(w.db, admin, w.id);
    assert.deepEqual(ctx?.destinatarios, ["duenio@local.test"]);
    assert.equal(await marcarReclamoNotificado(w.db, admin, w.id, "ok"), true);
    assert.equal(await marcarReclamoNotificado(w.db, admin, w.id, "ok"), false);
  });
});

describe("aviso por mail al local", () => {
  it("manda a cada destinatario, marca y no repite; sin proveedor no marca", async () => {
    const w = await ticket();
    const sentMails: string[] = [];
    let marked = 0;
    const deps = {
      contexto: (id: string) => contextoAvisoReclamo(w.db, admin, id),
      sender: async () => ({ provider: "cloudflare" as const, from: "x@y.z", send: async (m: { to: string }) => { sentMails.push(m.to); } }),
      marcar: async (id: string, d: string) => { marked += 1; return marcarReclamoNotificado(w.db, admin, id, d); },
      appUrl: "https://app.test",
    };
    assert.equal(await avisarReclamoNuevo(w.id, { ...deps, sender: async () => null }), "sin-proveedor");
    assert.equal(marked, 0);
    assert.equal(await avisarReclamoNuevo(w.id, deps), "enviado");
    assert.deepEqual(sentMails, ["duenio@local.test"]);
    assert.equal(await avisarReclamoNuevo(w.id, deps), "ya-avisado");
    const ctx = (await contextoAvisoReclamo(w.db, admin, w.id))!;
    const mail = renderAviso(ctx, "https://app.test");
    assert.match(mail.subject, /Reclamo #1: Llegó frío/);
    assert.doesNotMatch(mail.text, /5491170000001/);
  });

  it("la operación interna `reclamo` exige un id UUID y nada más", () => {
    const base = { conversationId: "c1", inboundWamid: "w1" };
    assert.equal(SCHEMAS.reclamo.safeParse({ ...base, reclamoId: crypto.randomUUID() }).success, true);
    assert.equal(SCHEMAS.reclamo.safeParse({ ...base, reclamoId: "x" }).success, false);
    assert.equal(SCHEMAS.reclamo.safeParse({ ...base, reclamoId: crypto.randomUUID(), email: "a@b.c" }).success, false);
  });
});

describe("API admin de reclamos", () => {
  async function apiWorld() {
    const w = await ticket();
    const id = w.id;
    const messages: string[] = [];
    const deps: ReclamosApiDeps = {
      list: (a, f) => listReclamos(w.db, a, f),
      get: (a, i) => getReclamo(w.db, a, i),
      porCategoria: (a, d) => reclamosPorCategoria(w.db, a, d),
      resumen: (a) => resumenReclamos(w.db, a, null),
      cambiarEstado: (a, i, x) => cambiarEstadoReclamo(w.db, a, i, x),
      nota: (a, i, t) => agregarNotaReclamo(w.db, a, i, t),
      resolver: (a, i, input) => resolverReclamo(w.db, a, i, input),
      enviar: async (_a, _i, t) => { messages.push(t); return { ok: true }; },
    };
    return { ...w, id, deps, messages };
  }

  it("solo admin", async () => {
    const w = await apiWorld();
    const cliente = { kind: "cliente", userId: "x" } as const;
    assert.equal((await listarReclamos(cliente, new URLSearchParams(), w.deps)).status, 403);
    assert.equal((await accionReclamo({ kind: "anon" }, w.id, { accion: "tomar" }, w.deps)).status, 403);
    assert.equal((await listarReclamos(admin, new URLSearchParams(), w.deps)).status, 200);
  });

  it("valida con zod: acción, filtros, compensación y id", async () => {
    const w = await apiWorld();
    assert.equal((await listarReclamos(admin, new URLSearchParams({ estado: "cualquiera" }), w.deps)).status, 400);
    assert.equal((await accionReclamo(admin, w.id, { accion: "borrar" }, w.deps)).status, 400);
    assert.equal((await accionReclamo(admin, w.id, { accion: "resolver", resolucion: "ok", compensacion: { tipo: "puntos", valor: 999999 } }, w.deps)).status, 400);
    assert.equal((await accionReclamo(admin, w.id, { accion: "nota", texto: "x", extra: 1 }, w.deps)).status, 400);
    assert.equal((await accionReclamo(admin, "no-uuid", { accion: "tomar" }, w.deps)).status, 400);
    assert.equal((await accionReclamo(admin, crypto.randomUUID(), { accion: "tomar" }, w.deps)).status, 404);
  });

  it("resolver con puntos suma los puntos y le escribe al cliente con la compensación", async () => {
    const w = await apiWorld();
    const r = await accionReclamo(admin, w.id, { accion: "resolver", resolucion: "Te reenviamos la pizza", compensacion: { tipo: "puntos", valor: 100 } }, w.deps);
    assert.equal(r.status, 200);
    assert.equal(r.body.puntosAcreditados, 100);
    assert.equal(w.messages[0], mensajeResolucion(1, "Te reenviamos la pizza", { tipo: "puntos", valor: 100 }));
    assert.match(w.messages[0], /^Tu reclamo #1 quedó resuelto: Te reenviamos la pizza\nTe sumamos 100 puntos/);
    assert.equal((await accionReclamo(admin, w.id, { accion: "resolver", resolucion: "otra" }, w.deps)).status, 409);
  });
});

describe("SLA y ventana de WhatsApp", () => {
  it("vence a las 2 h contando solo el tiempo con el local abierto", () => {
    const h = { open: "11:00", close: "23:00" };
    // 11:30 AR (14:30 UTC): abrió hace 30 min → nada vencido.
    assert.equal(slaCorte(h, new Date("2026-11-18T14:30:00Z")), null);
    // 14:00 AR: corte = 12:00 AR.
    assert.equal(slaCorte(h, new Date("2026-11-18T17:00:00Z")), "2026-11-18T15:00:00.000Z");
    // 02:00 AR: cerrado.
    assert.equal(slaCorte(h, new Date("2026-11-18T05:00:00Z")), null);
    assert.equal(slaCorte({ ...h, paused: true }, new Date("2026-11-18T17:00:00Z")), null);
  });
  it("ventana de 24 h", () => {
    const now = new Date("2026-11-18T12:00:00Z");
    assert.equal(dentroDeVentana("2026-11-18T00:00:00Z", now), true);
    assert.equal(dentroDeVentana("2026-11-17T11:00:00Z", now), false);
    assert.equal(dentroDeVentana(null, now), false);
  });
});

describe("aviso de reclamo nuevo en el panel", () => {
  const now = Date.parse("2026-11-18T15:00:00Z");
  const r = (id: string, numero: number, minAgo: number) => ({ id, numero, categoria: "demora" as const, client_name: "Tata", created_at: new Date(now - minAgo * 60_000).toISOString() });

  it("avisa solo los no vistos y recientes, el más viejo primero", () => {
    const list = [r("c", 3, 1), r("b", 2, 5), r("a", 1, 120)];
    assert.deepEqual(reclamosPorAvisar(list, new Set(), now).map((x) => x.id), ["b", "c"]);
    assert.deepEqual(reclamosPorAvisar(list, new Set(["b"]), now).map((x) => x.id), ["c"]);
    assert.equal(textoAviso(r("x", 7, 0)), "Ingresó un reclamo #7 — Demora — Tata");
  });

  it("recuerda los vistos en localStorage y tolera almacenamiento roto", () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const vistos = marcarVisto(storage, leerVistos(storage), "a");
    assert.deepEqual(JSON.parse(mem.get(SEEN_KEY)!), ["a"]);
    assert.ok(leerVistos(storage).has("a"));
    assert.ok(vistos.has("a"));
    const broken = { getItem: (): string | null => { throw new Error("bloqueado"); }, setItem: (): void => { throw new Error("bloqueado"); } };
    assert.equal(leerVistos(broken).size, 0);
    assert.ok(marcarVisto(broken, new Set(), "z").has("z"));
    mem.set(SEEN_KEY, "{no json");
    assert.equal(leerVistos(storage).size, 0);
  });
});
