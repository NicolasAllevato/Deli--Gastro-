import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TEMPLATES,
  metaPayload,
  paramCount,
  renderPreview,
  sanitizeParam,
  templateByName,
} from "../src/lib/whatsapp/templates.ts";
import { detectKeyword } from "../src/lib/whatsapp/keywords.ts";
import { selectRecipients, type CampaignClient, type CampaignOrder } from "../src/lib/whatsapp/segments.ts";
import { createWhatsAppClient, WhatsAppApiError } from "../src/lib/whatsapp/client.ts";

describe("catálogo de plantillas", () => {
  it("los nombres son únicos y cumplen el formato de Meta (minúsculas y guion bajo)", () => {
    const names = TEMPLATES.map((t) => t.name);
    assert.equal(new Set(names).size, names.length);
    for (const name of names) assert.match(name, /^[a-z][a-z0-9_]*$/);
  });

  it("las variables son {{1}}..{{n}} seguidas y el cuerpo no empieza ni termina con una variable", () => {
    for (const t of TEMPLATES) {
      const n = paramCount(t.body);
      for (let i = 1; i <= n; i++) assert.ok(t.body.includes(`{{${i}}}`), `${t.name} sin {{${i}}}`);
      assert.doesNotMatch(t.body.trim(), /^\{\{/, `${t.name} empieza con variable`);
      assert.doesNotMatch(t.body.trim(), /\}\}$/, `${t.name} termina con variable`);
    }
  });

  it("cada plantilla trae un ejemplo por variable (Meta lo exige para aprobar)", () => {
    for (const t of TEMPLATES) assert.equal(t.example.length, paramCount(t.body), t.name);
  });

  it("solo la promoción es de marketing y trae el aviso para darse de baja", () => {
    const marketing = TEMPLATES.filter((t) => t.category === "MARKETING");
    assert.deepEqual(marketing.map((t) => t.name), ["promocion"]);
    assert.match(marketing[0]!.footer ?? "", /BAJA/);
  });

  it("incluye confirmación, seguimiento por etapa y encuesta", () => {
    for (const name of ["confirmacion_pedido", "pedido_en_preparacion", "pedido_en_camino", "pedido_entregado", "encuesta_satisfaccion"]) {
      assert.ok(templateByName(name), name);
    }
    assert.equal(templateByName("no_existe"), undefined);
  });
});

describe("renderPreview y sanitizeParam", () => {
  it("renderPreview completa las variables", () => {
    const t = templateByName("pedido_entregado")!;
    assert.equal(renderPreview(t, ["Ana", "#AB12"]), "¡Hola Ana! Tu pedido #AB12 fue entregado. ¡Que lo disfrutes!");
  });

  it("sanitizeParam saca saltos de línea y tabulaciones, junta espacios y recorta", () => {
    assert.equal(sanitizeParam("  2x1\nen   pizzas\t hoy  "), "2x1 en pizzas hoy");
  });

  it("sanitizeParam limita el largo", () => {
    assert.equal(sanitizeParam("x".repeat(2000)).length, 300);
  });
});

describe("metaPayload", () => {
  it("arma el cuerpo con ejemplo y el pie cuando existe", () => {
    const t = templateByName("promocion")!;
    const payload = metaPayload(t);
    assert.equal(payload.name, "promocion");
    assert.equal(payload.language, "es_AR");
    assert.equal(payload.category, "MARKETING");
    const body = payload.components.find((c) => c.type === "BODY");
    assert.deepEqual(body?.example, { body_text: [t.example] });
    assert.ok(payload.components.some((c) => c.type === "FOOTER"));
  });

  it("no agrega pie si la plantilla no lo tiene", () => {
    const payload = metaPayload(templateByName("pedido_entregado")!);
    assert.equal(payload.components.some((c) => c.type === "FOOTER"), false);
  });
});

describe("detectKeyword", () => {
  it("reconoce la baja de promociones", () => {
    for (const text of ["BAJA", "baja", " Baja. ", "STOP", "no quiero más promos", "dar de baja"]) {
      assert.equal(detectKeyword(text), "opt_out", text);
    }
  });

  it("reconoce el alta de promociones", () => {
    for (const text of ["ALTA", "alta", "quiero promos", "Quiero recibir promociones"]) {
      assert.equal(detectKeyword(text), "opt_in", text);
    }
  });

  it("no confunde una conversación normal con una palabra clave", () => {
    for (const text of ["hola", "quiero una pizza", "dame de baja el volumen", "la baja temperatura", "tenés alta cocina?"]) {
      assert.equal(detectKeyword(text), null, text);
    }
  });
});

const NOW = new Date("2026-10-04T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const clients: CampaignClient[] = [
  { id: "a", name: "Ana", phone: "+54 9 11 5555-0001", tier: "Oro", optedIn: true },
  { id: "b", name: "Beto", phone: "+54 9 11 5555-0002", tier: "Bronce", optedIn: true },
  { id: "c", name: "Cami", phone: "+54 9 11 5555-0003", tier: "Plata", optedIn: false },
  { id: "d", name: "Dani", phone: null, tier: "Oro", optedIn: true },
  { id: "e", name: "Eli", phone: "+54 9 11 5555-0005", tier: "Oro", optedIn: true },
];

const orders: CampaignOrder[] = [
  // Ana: 3 pedidos recientes (frecuente)
  { client_id: "a", created_at: daysAgo(2), status: "Finalizados" },
  { client_id: "a", created_at: daysAgo(10), status: "Finalizados" },
  { client_id: "a", created_at: daysAgo(20), status: "Finalizados" },
  // Beto: un solo pedido hace 45 días (inactivo)
  { client_id: "b", created_at: daysAgo(45), status: "Finalizados" },
  // Cami: no aceptó promos
  { client_id: "c", created_at: daysAgo(60), status: "Finalizados" },
  // Eli: solo pedidos cancelados (no cuentan)
  { client_id: "e", created_at: daysAgo(3), status: "Cancelado" },
];

describe("selectRecipients", () => {
  const ids = (r: ReturnType<typeof selectRecipients>) => r.map((x) => x.id);

  it("'all' incluye solo a quienes aceptaron promociones y tienen teléfono", () => {
    assert.deepEqual(ids(selectRecipients(clients, orders, { kind: "all" }, NOW)), ["a", "b", "e"]);
  });

  it("'inactive' elige a quienes no piden hace N días o nunca pidieron", () => {
    assert.deepEqual(ids(selectRecipients(clients, orders, { kind: "inactive", days: 30 }, NOW)), ["b", "e"]);
  });

  it("'frequent' elige a quienes pidieron al menos N veces en los últimos 60 días", () => {
    assert.deepEqual(ids(selectRecipients(clients, orders, { kind: "frequent", minOrders: 3 }, NOW)), ["a"]);
  });

  it("'tier' filtra por nivel de fidelidad", () => {
    assert.deepEqual(ids(selectRecipients(clients, orders, { kind: "tier", tier: "Oro" }, NOW)), ["a", "e"]);
  });

  it("nunca incluye a quien no aceptó recibir promociones", () => {
    for (const segment of [{ kind: "all" }, { kind: "inactive", days: 1 }, { kind: "tier", tier: "Plata" }] as const) {
      assert.ok(!ids(selectRecipients(clients, orders, segment, NOW)).includes("c"));
    }
  });
});

describe("plantillas en el cliente de WhatsApp", () => {
  const creds = { accessToken: "T", phoneNumberId: "P", wabaId: "WABA" };

  function fakeFetch(response: unknown, status = 200) {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const impl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(response), { status });
    }) as typeof fetch;
    return { impl, calls };
  }

  it("listTemplates pide las plantillas de la cuenta y devuelve nombre y estado", async () => {
    const { impl, calls } = fakeFetch({ data: [{ name: "promocion", status: "APPROVED", category: "MARKETING", language: "es_AR" }] });
    const list = await createWhatsAppClient(creds, impl).listTemplates();
    assert.match(calls[0]!.url, /\/WABA\/message_templates\?/);
    assert.deepEqual(list, [{ name: "promocion", status: "APPROVED", category: "MARKETING", language: "es_AR" }]);
  });

  it("createTemplate manda la definición y devuelve el estado inicial", async () => {
    const { impl, calls } = fakeFetch({ id: "123", status: "PENDING", category: "UTILITY" });
    const result = await createWhatsAppClient(creds, impl).createTemplate(metaPayload(templateByName("pedido_entregado")!));
    assert.equal(result.status, "PENDING");
    assert.equal(calls[0]!.init?.method, "POST");
    assert.equal(JSON.parse(String(calls[0]!.init?.body)).name, "pedido_entregado");
  });

  it("sin WABA ID no se pueden administrar plantillas", async () => {
    const { impl } = fakeFetch({});
    await assert.rejects(
      createWhatsAppClient({ accessToken: "T", phoneNumberId: "P" }, impl).listTemplates(),
      (err: unknown) => err instanceof WhatsAppApiError && /WABA/.test(err.message),
    );
  });
});
