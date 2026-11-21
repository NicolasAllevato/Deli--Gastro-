/**
 * Consulta sin respuesta (ticket de reclamos con motivo «Consulta sin respuesta: …» y categoría otro) vs. reclamo normal:
 * la app NO pide sugerencia de compensación a OpenAI, manda un mail propio (sin la palabra reclamo) y el panel la distingue.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./helpers/alias.ts";
import { createTestDb } from "./helpers/sqlite-d1.ts";
import { processTurn } from "../workers/whatsapp-bot/src/bot/turn.ts";
import { d1BotRepo } from "../workers/whatsapp-bot/src/repo/d1.ts";
import { CONSULTA_PREFIX as BOT_PREFIX } from "../workers/whatsapp-bot/src/bot/complaints.ts";
import type { OrdersClient, ReclamoRequest } from "../workers/whatsapp-bot/src/orders/client.ts";
import { CONSULTA_PREFIX, esConsulta, textoConsulta } from "../src/lib/reclamos/categoria.ts";
import { avisarReclamoNuevo, avisarYSugerir, renderAviso } from "../src/lib/reclamos/notify.ts";
import { ejecutarAgente, ES_CONSULTA_ERROR, type DatosAgente } from "../src/lib/reclamos/agente.ts";
import { mensajeResolucion } from "../src/lib/reclamos/mensajes.ts";
import { textoAviso } from "../src/lib/reclamos/aviso-panel.ts";
import type { ReclamosApiDeps } from "../src/lib/reclamos/api.ts";
import {
  contextoAvisoReclamo, getReclamo, marcarReclamoNotificado, resolverReclamo, resumenReclamos,
} from "../src/lib/data/reclamos.ts";
import type { ReclamoAvisoContexto } from "../src/lib/data/reclamos.ts";

// api.ts usa `@/lib/data`: se importa después de registrar el alias.
const { accionReclamo } = await import("../src/lib/reclamos/api.ts");

const PHONE = "5491170000001";
const admin = { kind: "admin", userId: "u1" } as const;
const OPEN = { horario_apertura: "00:00", horario_cierre: "23:59" };

/** Un local con un cliente y una conversación; el bot (real, con D1) deriva según lo que diga el «modelo». */
function setup(reason: string, userText: string) {
  const db = createTestDb();
  const cfg = db.raw.prepare("INSERT INTO global_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value");
  for (const [k, v] of Object.entries({ agente_activo: true, ...OPEN })) cfg.run(k, JSON.stringify(v));
  cfg.run("resumen_diario", JSON.stringify({ activo: true, hora: "23:30", destinatarios: [{ id: "1", nombre: "Dueño", email: "duenio@local.test", telefono: "", activo: true }] }));
  db.raw.exec("INSERT INTO clients (id, name, phone, phone_digits) VALUES ('cl1', 'Tata', '5491170000001', '1170000001')");
  db.raw.exec(`INSERT INTO wa_conversations (id, client_phone, contact_name, client_id, last_inbound_at) VALUES ('c1', '${PHONE}', 'Tata', 'cl1', '${new Date().toISOString()}')`);
  db.raw
    .prepare("INSERT INTO orders (id, client_id, items_desc, total_cents, created_at) VALUES ('abcd1234-0000-4000-8000-000000000001', 'cl1', '1x Muzza', 1250000, ?)")
    .run(new Date(Date.now() - 60 * 60_000).toISOString());
  const repo = { ...d1BotRepo(db), lastOutboundAt: async () => new Date() };
  const sent: string[] = [];
  const notified: ReclamoRequest[] = [];
  const orders = { reclamo: async (b: ReclamoRequest) => { notified.push(b); return { ok: true as const, status: 200, data: { ok: true } }; } } as unknown as OrdersClient;
  let n = 0;
  const turn = () => {
    const wamid = `in-${++n}`;
    db.raw.prepare("INSERT INTO wa_messages (id, conversation_id, wamid, direction, type, body) VALUES (?, 'c1', ?, 'in', 'text', ?)").run(crypto.randomUUID(), wamid, userText);
    const run = async (_m: string, input: Record<string, unknown>) => {
      if ("response_format" in input) return { response: JSON.stringify({ intent: "consulta_local", confidence: 0.95 }) };
      const used = (input.messages as { role: string }[]).some((m) => m.role === "tool");
      return used ? { response: "Perdón, no sé." } : { tool_calls: [{ name: "handoff_to_human", arguments: { reason } }] };
    };
    return processTurn(
      { phone: PHONE, text: userText, wamids: [wamid], audios: [], images: [], receivedAt: 0 },
      { repo, run, transcribe: async () => null, appUrl: "https://opsyndely.la-gambeta.com", orders, log: () => {}, send: async (_p, t) => { sent.push(t); return `o-${sent.length}`; } },
    );
  };
  const rows = () => db.raw.prepare("SELECT * FROM reclamos").all() as Array<Record<string, string | number | null>>;
  return { db, turn, sent, notified, rows };
}

async function consultaWorld() {
  const w = setup("consulta: si hacen pizza sin gluten", "¿hacen pizza sin gluten?");
  assert.equal(await w.turn(), "ticket");
  return { ...w, id: String(w.rows()[0].id) };
}

async function reclamoWorld() {
  const w = setup("llegó frío", "llegó frío, un desastre");
  assert.equal(await w.turn(), "ticket");
  return { ...w, id: String(w.rows()[0].id) };
}

describe("esConsulta / textoConsulta", () => {
  it("el prefijo del bot y el de la app son el mismo", () => {
    assert.equal(BOT_PREFIX, CONSULTA_PREFIX);
  });

  it("consulta: motivo con el prefijo y categoría otro", () => {
    assert.equal(esConsulta({ motivo: `${CONSULTA_PREFIX}¿hacen sin gluten?`, categoria: "otro" }), true);
    assert.equal(esConsulta({ motivo: "  Consulta sin respuesta: x", categoria: "otro" }), true);
    assert.equal(esConsulta({ motivo: "Consulta sin respuesta:", categoria: "otro" }), true);
  });

  it("reclamo: sin prefijo, o con una queja reconocida sumada a la consulta (la categoría deja de ser otro)", () => {
    assert.equal(esConsulta({ motivo: "llegó frío", categoria: "llego_frio" }), false);
    assert.equal(esConsulta({ motivo: "quiero hacer un reclamo", categoria: "otro" }), false);
    assert.equal(esConsulta({ motivo: "Foto del pedido", categoria: "otro" }), false);
    assert.equal(esConsulta({ motivo: `${CONSULTA_PREFIX}¿sin gluten?\nme llegó frío`, categoria: "llego_frio" }), false);
    // Un reclamo al que después se suma una consulta sigue siendo un reclamo.
    assert.equal(esConsulta({ motivo: `me faltó una pizza\n${CONSULTA_PREFIX}¿sin gluten?`, categoria: "otro" }), false);
  });

  it("el texto de la consulta sale sin el prefijo; un reclamo queda igual", () => {
    assert.equal(textoConsulta(`${CONSULTA_PREFIX}¿hacen sin gluten?`), "¿hacen sin gluten?");
    assert.equal(textoConsulta("Consulta sin respuesta:"), "");
    assert.equal(textoConsulta("llegó frío"), "llegó frío");
  });
});

describe("el bot guarda la consulta de forma que la app la reconoce", () => {
  it("consulta: ticket con prefijo y categoría otro, aviso a la app; reclamo: no es consulta", async () => {
    const c = await consultaWorld();
    const d = (await getReclamo(c.db, admin, c.id))!;
    assert.equal(d.categoria, "otro");
    assert.equal(d.order_id, null);
    assert.equal(esConsulta(d), true);
    assert.equal(c.notified.length, 1);
    assert.equal(c.notified[0].reclamoId, c.id);

    const r = await reclamoWorld();
    assert.equal(esConsulta((await getReclamo(r.db, admin, r.id))!), false);
  });
});

describe("mail al local", () => {
  it("la consulta lleva su propio mail: «consulta pendiente de respuesta», sin la palabra reclamo ni el teléfono completo", async () => {
    const w = await consultaWorld();
    const ctx = (await contextoAvisoReclamo(w.db, admin, w.id))!;
    const mail = renderAviso(ctx, "https://app.test/");
    assert.match(mail.subject, /Consulta pendiente de respuesta #1/);
    for (const part of [mail.subject, mail.text, mail.html]) {
      // El link al panel es /admin/reclamos (la sección se llama así): se mira el texto sin las URL.
      assert.doesNotMatch(part.replace(/https?:\/\/[^\s"<]+/g, ""), /reclamo/i, "no habla de reclamo");
      assert.doesNotMatch(part, /5491170000001/);
    }
    assert.match(mail.text, /Qué preguntó: .*pizza sin gluten/);
    assert.doesNotMatch(mail.text, /Consulta sin respuesta:/, "sin el prefijo interno");
    assert.doesNotMatch(mail.text, /Pedido|Fotos/);
    assert.match(mail.text, /https:\/\/app\.test\/admin\/reclamos\?id=/);
  });

  it("escapa el texto del cliente en el HTML", () => {
    const base = fakeContext(`${CONSULTA_PREFIX}<script>alert(1)</script> & "x"`, "otro");
    const mail = renderAviso(base, "https://app.test");
    assert.doesNotMatch(mail.html, /<script>/);
    assert.match(mail.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;x&quot;/);
  });

  it("el reclamo normal sigue con su mail de siempre", async () => {
    const w = await reclamoWorld();
    const ctx = (await contextoAvisoReclamo(w.db, admin, w.id))!;
    const mail = renderAviso(ctx, "https://app.test");
    assert.match(mail.subject, /Reclamo #1: Llegó frío/);
    assert.match(mail.text, /^Nuevo reclamo #1 \(Llegó frío\)/);
    assert.match(mail.text, /Pedido #ABCD1234: 1x Muzza/);
    assert.doesNotMatch(mail.subject + mail.text, /consulta/i);
  });

  it("se manda una sola vez por consulta (marca notified_at)", async () => {
    const w = await consultaWorld();
    const mails: Array<{ to: string; subject: string }> = [];
    const deps = {
      contexto: (id: string) => contextoAvisoReclamo(w.db, admin, id),
      sender: async () => ({ provider: "cloudflare" as const, from: "x@y.z", send: async (m: { to: string; subject: string }) => { mails.push(m); } }),
      marcar: (id: string, d: string) => marcarReclamoNotificado(w.db, admin, id, d),
      appUrl: "https://app.test",
    };
    assert.equal(await avisarReclamoNuevo(w.id, deps), "enviado");
    assert.equal(await avisarReclamoNuevo(w.id, deps), "ya-avisado");
    assert.equal(mails.length, 1);
    assert.match(mails[0].subject, /Consulta pendiente de respuesta/);
  });
});

describe("avisarYSugerir: la app no pide sugerencia de compensación para una consulta", () => {
  function deps(ctx: ReclamoAvisoContexto | null, over: { throwContexto?: boolean } = {}) {
    const calls = { sugerir: [] as string[], mails: [] as string[], marcados: [] as string[] };
    return {
      calls,
      deps: {
        contexto: async () => {
          if (over.throwContexto) throw new Error("db caída");
          return ctx;
        },
        sender: async () => ({ provider: "cloudflare" as const, from: "x@y.z", send: async (m: { subject: string }) => { calls.mails.push(m.subject); } }),
        marcar: async (id: string) => { calls.marcados.push(id); return true; },
        appUrl: "https://app.test",
        sugerir: async (id: string) => { calls.sugerir.push(id); },
      },
    };
  }

  it("consulta: mail propio y NINGUNA sugerencia", async () => {
    const { calls, deps: d } = deps(fakeContext(`${CONSULTA_PREFIX}¿hacen sin gluten?`, "otro"));
    assert.equal(await avisarYSugerir("r1", d), "enviado");
    assert.deepEqual(calls.sugerir, []);
    assert.equal(calls.mails.length, 1);
    assert.match(calls.mails[0], /Consulta pendiente de respuesta/);
    assert.deepEqual(calls.marcados, ["r1"]);
  });

  it("consulta ya avisada (nueva información del cliente): tampoco sugiere", async () => {
    const { calls, deps: d } = deps(fakeContext(`${CONSULTA_PREFIX}¿hacen sin gluten?`, "otro", { notified_at: "2026-11-20T10:00:00Z" }));
    assert.equal(await avisarYSugerir("r1", d), "ya-avisado");
    assert.deepEqual(calls.sugerir, []);
    assert.deepEqual(calls.mails, []);
  });

  it("reclamo normal: mail de reclamo y una sugerencia, como siempre", async () => {
    const { calls, deps: d } = deps(fakeContext("llegó frío", "llego_frio"));
    assert.equal(await avisarYSugerir("r1", d), "enviado");
    assert.deepEqual(calls.sugerir, ["r1"]);
    assert.match(calls.mails[0], /Reclamo #1: Llegó frío/);
  });

  it("reclamo ya avisado: igual pide una sugerencia nueva (comportamiento anterior)", async () => {
    const { calls, deps: d } = deps(fakeContext("llegó frío", "llego_frio", { notified_at: "2026-11-20T10:00:00Z" }));
    assert.equal(await avisarYSugerir("r1", d), "ya-avisado");
    assert.deepEqual(calls.sugerir, ["r1"]);
  });

  it("ticket que no existe (o de otra conversación): no-existe y sin sugerencia", async () => {
    const { calls, deps: d } = deps(null);
    assert.equal(await avisarYSugerir("r1", d), "no-existe");
    assert.deepEqual(calls.sugerir, []);
  });

  it("si no se puede leer el ticket no tira ni sugiere", async () => {
    const { calls, deps: d } = deps(null, { throwContexto: true });
    const original = console.error;
    console.error = () => {};
    try {
      assert.equal(await avisarYSugerir("r1", d), "fallo");
    } finally {
      console.error = original;
    }
    assert.deepEqual(calls.sugerir, []);
  });
});

describe("agente de reclamos: una consulta no llama a OpenAI", () => {
  const datos = (motivo: string, categoria: DatosAgente["reclamo"]["categoria"]): DatosAgente => ({
    reclamo: { numero: 4, categoria, motivo, foto_keys: [], created_at: "2026-11-20T10:00:00Z", client_name: "Tata" },
    pedido: null,
    pedidosCliente: 3,
    ultimosPedidos: [],
    reclamosPrevios: [],
    config: { maxPuntos: 300, maxDescuentoPct: 15 },
  });

  it("consulta: sin fetch, sin clave pedida y sin guardar nada (ni siquiera un error)", async () => {
    let fetches = 0;
    let keys = 0;
    const saved: unknown[] = [];
    const r = await ejecutarAgente("x", {
      datos: async () => datos(`${CONSULTA_PREFIX}¿hacen sin gluten?`, "otro"),
      apiKey: async () => { keys += 1; return "sk"; },
      guardar: async (_id, v) => { saved.push(v); },
      fetchImpl: (async () => { fetches += 1; return new Response("{}"); }) as typeof fetch,
    });
    assert.deepEqual(r, { ok: false, error: ES_CONSULTA_ERROR });
    assert.deepEqual([fetches, keys, saved.length], [0, 0, 0]);
  });

  it("reclamo normal: llama a OpenAI y guarda la sugerencia", async () => {
    let fetches = 0;
    const saved: unknown[] = [];
    const out = { diagnostico: "Llegó frío.", resolucion: { tipo: "disculpa", valor: null, motivo: "Leve" }, mensaje: "Perdón 🙏" };
    const r = await ejecutarAgente("x", {
      datos: async () => datos("llegó frío", "llego_frio"),
      apiKey: async () => "sk",
      guardar: async (_id, v) => { saved.push(v); },
      fetchImpl: (async () => { fetches += 1; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }] })); }) as typeof fetch,
    });
    assert.equal(r.ok, true);
    assert.equal(fetches, 1);
    assert.equal(saved.length, 1);
  });
});

describe("API admin con una consulta", () => {
  async function apiWorld(world: Awaited<ReturnType<typeof consultaWorld>>) {
    const messages: string[] = [];
    const resolved: Array<{ compensacion?: unknown; mensaje?: string }> = [];
    let sugeridos = 0;
    const deps: Partial<ReclamosApiDeps> = {
      get: (a, i) => getReclamo(world.db, a, i),
      resolver: (a, i, input) => { resolved.push(input); return resolverReclamo(world.db, a, i, input); },
      enviar: async (_a, _i, t) => { messages.push(t); return { ok: true } as const; },
      marcarNotificacion: async () => {},
      sugerir: async () => { sugeridos += 1; return { ok: true, sugerencia: {} } as const; },
    };
    return { deps: deps as ReclamosApiDeps, messages, resolved, sugeridos: () => sugeridos };
  }

  it("«sugerir» responde 409 sin llamar al agente", async () => {
    const w = await consultaWorld();
    const api = await apiWorld(w);
    const r = await accionReclamo(admin, w.id, { accion: "sugerir" }, api.deps);
    assert.equal(r.status, 409);
    assert.equal(r.body.error, ES_CONSULTA_ERROR);
    assert.equal(api.sugeridos(), 0);
  });

  it("«sugerir» en un reclamo normal sigue funcionando", async () => {
    const w = await reclamoWorld();
    const api = await apiWorld(w);
    const r = await accionReclamo(admin, w.id, { accion: "sugerir" }, api.deps);
    assert.equal(r.status, 200);
    assert.equal(api.sugeridos(), 1);
  });

  it("resolver una consulta: aviso sin la palabra reclamo y sin puntos aunque lleguen en el pedido", async () => {
    const w = await consultaWorld();
    const api = await apiWorld(w);
    const r = await accionReclamo(admin, w.id, { accion: "resolver", resolucion: "Sí, hacemos pizza sin gluten por encargo.", compensacion: { tipo: "puntos", valor: 100 } }, api.deps);
    assert.equal(r.status, 200);
    assert.equal(r.body.puntosAcreditados, 0);
    assert.equal(api.resolved[0].compensacion, null);
    assert.equal(api.messages[0], "Sobre tu consulta: Sí, hacemos pizza sin gluten por encargo.\nGracias por escribirnos 🙏");
    assert.doesNotMatch(api.messages[0], /reclamo/i);
    assert.equal((w.db.raw.prepare("SELECT count(*) AS n FROM points_ledger").get() as { n: number }).n, 0);
    assert.equal((await getReclamo(w.db, admin, w.id))?.estado, "resuelto");
  });

  it("resolver un reclamo normal: el mensaje de siempre, con su compensación", async () => {
    const w = await reclamoWorld();
    const api = await apiWorld(w);
    const r = await accionReclamo(admin, w.id, { accion: "resolver", resolucion: "Te reenviamos la pizza", compensacion: { tipo: "puntos", valor: 100 } }, api.deps);
    assert.equal(r.body.puntosAcreditados, 100);
    assert.equal(api.messages[0], mensajeResolucion(1, "Te reenviamos la pizza", { tipo: "puntos", valor: 100 }));
    assert.match(api.messages[0], /^Tu reclamo #1 quedó resuelto/);
  });

  it("mensajeResolucion: la consulta no habla de reclamo ni de compensación", () => {
    assert.equal(mensajeResolucion(5, " Abrimos a las 11 ", null, true), "Sobre tu consulta: Abrimos a las 11\nGracias por escribirnos 🙏");
    assert.match(mensajeResolucion(5, "ok", null), /^Tu reclamo #5 quedó resuelto: ok\nGracias por avisarnos/);
  });
});

describe("panel: aviso de ingreso", () => {
  it("el resumen marca cuáles de los abiertos son consultas, sin mandar el texto del cliente", async () => {
    const c = await consultaWorld();
    const resumenConsulta = await resumenReclamos(c.db, admin, null);
    assert.equal(resumenConsulta.recientes.length, 1);
    assert.equal(resumenConsulta.recientes[0].consulta, true);
    assert.equal("motivo" in resumenConsulta.recientes[0], false);

    const r = await reclamoWorld();
    assert.equal((await resumenReclamos(r.db, admin, null)).recientes[0].consulta, false);
  });

  it("el texto del aviso dice consulta (sin categoría) o reclamo según corresponda", () => {
    const base = { id: "a", numero: 7, categoria: "otro" as const, client_name: "Tata", created_at: "2026-11-20T10:00:00Z" };
    assert.equal(textoAviso({ ...base, consulta: true }), "Ingresó una consulta sin respuesta #7 — Tata");
    assert.equal(textoAviso({ ...base, categoria: "demora" }), "Ingresó un reclamo #7 — Demora — Tata");
    assert.equal(textoAviso({ ...base, consulta: false, client_name: null }), "Ingresó un reclamo #7 — Otro — Cliente sin nombre");
  });
});

/** Contexto de aviso mínimo para probar sin base (los campos que usa el mail y la decisión de consulta). */
function fakeContext(motivo: string, categoria: string, over: { notified_at?: string | null } = {}): ReclamoAvisoContexto {
  return {
    reclamo: {
      id: "r1", numero: 1, conversation_id: "c1", client_phone: PHONE, client_id: "cl1", client_name: "Tata", order_id: null,
      categoria, motivo, foto_keys: [], estado: "abierto", notified_at: over.notified_at ?? null,
    },
    pedido: null,
    destinatarios: ["duenio@local.test"],
    emailFrom: undefined,
    businessName: "La Gambeta",
  } as unknown as ReclamoAvisoContexto;
}
