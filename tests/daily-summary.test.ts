import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDemoDb } from "./helpers/demo-db.ts";
import type { DailySummarySettings } from "../src/lib/daily-summary/settings.ts";

// Import dinámico: los módulos usan el alias `@/` que registra el helper de la base falsa.
const { isDue, localClock, parseSettings } = await import("../src/lib/daily-summary/settings.ts");
const { buildDailySummary, renderEmail, whatsappParams } = await import("../src/lib/daily-summary/summary.ts");
const { emailConfig } = await import("../src/lib/daily-summary/email.ts");
const { runDailySummaryIfDue, sendDailySummaryNow } = await import("../src/lib/daily-summary/send.ts");

// 16/10/2026 23:45 en Buenos Aires = 17/10 02:45 UTC.
const NIGHT = new Date("2026-10-17T02:45:00Z");
const AFTERNOON = new Date("2026-10-16T20:00:00Z"); // 17:00 en Buenos Aires

const settings = (over: Partial<DailySummarySettings> = {}): DailySummarySettings => ({
  activo: true,
  hora: "23:30",
  destinatarios: [{ id: "a", nombre: "Ana Pérez", email: "ana@local.com", telefono: "5491155550101", activo: true }],
  ...over,
});

describe("hora de cierre", () => {
  it("localClock usa la fecha y hora de Buenos Aires, no UTC", () => {
    assert.deepEqual(localClock(NIGHT), { date: "2026-10-16", minutes: 23 * 60 + 45 });
  });

  it("solo corresponde enviar pasada la hora y una vez por día", () => {
    assert.equal(isDue(settings(), null, NIGHT), true);
    assert.equal(isDue(settings(), null, AFTERNOON), false);
    assert.equal(isDue(settings(), { fecha: "2026-10-16", email: 1, whatsapp: 1, errores: 0 }, NIGHT), false);
    assert.equal(isDue(settings(), { fecha: "2026-10-15", email: 1, whatsapp: 1, errores: 0 }, NIGHT), true);
  });

  it("no envía si está desactivado o no hay destinatarios activos", () => {
    assert.equal(isDue(settings({ activo: false }), null, NIGHT), false);
    assert.equal(isDue(settings({ destinatarios: [] }), null, NIGHT), false);
    const off = settings().destinatarios.map((r) => ({ ...r, activo: false }));
    assert.equal(isDue(settings({ destinatarios: off }), null, NIGHT), false);
  });

  it("parseSettings descarta destinatarios inválidos y usa valores por defecto", () => {
    const parsed = parseSettings({
      activo: true,
      hora: "25:99",
      destinatarios: [{ id: "x", nombre: "Sin contacto", email: "", telefono: "", activo: true }],
    });
    assert.equal(parsed.hora, "23:30");
    assert.equal(parsed.destinatarios.length, 0);
  });
});

describe("buildDailySummary", () => {
  const bounds = { from: "2026-10-16T03:00:00.000Z", to: "2026-10-17T03:00:00.000Z" };
  const order = (over: Record<string, unknown>) => ({
    id: "o",
    client_id: null,
    status: "Finalizados",
    total: 1000,
    delivery_fee: 0,
    channel: "web",
    payment_method: null,
    items_desc: "1x Pizza",
    created_at: "2026-10-16T15:00:00.000Z",
    accepted_at: null,
    ready_at: null,
    picked_up_at: null,
    delivered_at: "2026-10-16T15:30:00.000Z",
    ...over,
  });

  it("cuenta solo el día, excluye cancelados de las ventas y calcula promedios", () => {
    const summary = buildDailySummary(
      [
        order({ id: "1", total: 3000, items_desc: "2x Pizza · 1x Flan" }),
        order({ id: "2", total: 1000, delivered_at: "2026-10-16T15:50:00.000Z", items_desc: "1x Pizza" }),
        order({ id: "3", status: "Cancelado", total: 9999 }),
        order({ id: "4", status: "En Camino", total: 500, delivered_at: null, channel: "whatsapp" }),
        order({ id: "ayer", created_at: "2026-10-15T15:00:00.000Z" }),
      ] as never,
      bounds,
      "2026-10-16",
    );
    assert.equal(summary.orders, 4);
    assert.equal(summary.delivered, 2);
    assert.equal(summary.cancelled, 1);
    assert.equal(summary.inProgress, 1);
    assert.equal(summary.revenue, 4500);
    assert.equal(summary.avgTicket, 1500);
    assert.equal(summary.avgDeliveryMinutes, 40); // (30 + 50) / 2
    assert.deepEqual(summary.topProducts[0], { name: "Pizza", qty: 4 });
  });

  it("un día sin pedidos no rompe nada", () => {
    const summary = buildDailySummary([], bounds, "2026-10-16");
    assert.equal(summary.avgTicket, 0);
    assert.equal(summary.avgDeliveryMinutes, null);
    assert.match(renderEmail(summary, "Local").text, /Pedidos del día: 0/);
  });

  it("escapa el HTML del nombre del local y arma los 7 parámetros de WhatsApp", () => {
    const summary = buildDailySummary([], bounds, "2026-10-16");
    assert.ok(!renderEmail(summary, "<script>x</script>").html.includes("<script>"));
    assert.equal(whatsappParams(summary, "Local", "Ana").length, 7);
  });
});

describe("emailConfig", () => {
  it("necesita clave y remitente", () => {
    assert.equal(emailConfig(undefined, {}), null);
    assert.equal(emailConfig("a@b.com", {}), null);
    assert.deepEqual(emailConfig("a@b.com", { RESEND_API_KEY: "k" }), { apiKey: "k", from: "a@b.com" });
    assert.deepEqual(emailConfig("", { RESEND_API_KEY: "k", RESUMEN_EMAIL_FROM: "z@b.com" }), {
      apiKey: "k",
      from: "z@b.com",
    });
  });
});

describe("envío del resumen", () => {
  const fakes = () => {
    const mails: string[] = [];
    const messages: string[][] = [];
    return {
      mails,
      messages,
      deps: {
        email: { apiKey: "k", from: "local@x.com" },
        sendEmail: async (_c: unknown, m: { to: string }) => {
          mails.push(m.to);
        },
        whatsapp: {
          sendTemplate: async (to: string, name: string, _l: string, params: string[]) => {
            messages.push([to, name, ...params]);
            return "wamid";
          },
        },
      },
    };
  };
  const withSettings = (demo: ReturnType<typeof createDemoDb>, value: DailySummarySettings) => {
    const rows = demo.store.global_config;
    const existing = rows.find((r) => r.key === "resumen_diario");
    if (existing) existing.value = value;
    else rows.push({ key: "resumen_diario", value });
  };

  it("manda mail y WhatsApp una sola vez por día", async () => {
    const demo = createDemoDb();
    withSettings(demo, settings());
    const f = fakes();

    const first = await runDailySummaryIfDue(demo.db, NIGHT, f.deps as never);
    assert.ok(first.sent);
    assert.deepEqual(f.mails, ["ana@local.com"]);
    assert.equal(f.messages[0]![0], "5491155550101");
    assert.equal(f.messages[0]![1], "resumen_diario");

    const second = await runDailySummaryIfDue(demo.db, NIGHT, f.deps as never);
    assert.equal(second.sent, false);
    assert.equal(f.mails.length, 1);
  });

  it("antes de la hora de cierre no envía nada", async () => {
    const demo = createDemoDb();
    withSettings(demo, settings());
    const f = fakes();
    const result = await runDailySummaryIfDue(demo.db, AFTERNOON, f.deps as never);
    assert.equal(result.sent, false);
    assert.equal(f.mails.length, 0);
  });

  it("un destinatario con error no frena a los demás", async () => {
    const demo = createDemoDb();
    withSettings(
      demo,
      settings({
        destinatarios: [
          { id: "a", nombre: "Ana", email: "falla@x.com", telefono: "", activo: true },
          { id: "b", nombre: "Beto", email: "beto@x.com", telefono: "", activo: true },
        ],
      }),
    );
    const f = fakes();
    f.deps.sendEmail = async (_c, m) => {
      if (m.to.startsWith("falla")) throw new Error("boom");
      f.mails.push(m.to);
    };

    const result = await runDailySummaryIfDue(demo.db, NIGHT, f.deps as never);
    assert.ok(result.sent);
    assert.equal(result.email.sent, 1);
    assert.equal(result.email.failed, 1);
    assert.deepEqual(f.mails, ["beto@x.com"]);
  });

  it("sin servicio de correo ni WhatsApp informa sin-configurar", async () => {
    const demo = createDemoDb();
    withSettings(demo, settings());
    const report = await sendDailySummaryNow(demo.db, NIGHT, { email: null, whatsapp: null });
    assert.equal(report.email.status, "sin-configurar");
    assert.equal(report.whatsapp.status, "sin-configurar");
  });

  it("el envío de prueba no marca el día como enviado", async () => {
    const demo = createDemoDb();
    withSettings(demo, settings());
    const f = fakes();
    await sendDailySummaryNow(demo.db, NIGHT, f.deps as never);
    assert.equal(demo.store.global_config.some((r) => r.key === "resumen_diario_ultimo"), false);
    const real = await runDailySummaryIfDue(demo.db, NIGHT, f.deps as never);
    assert.ok(real.sent);
  });
});
