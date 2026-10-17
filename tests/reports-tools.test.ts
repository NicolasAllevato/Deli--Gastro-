import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReportTools, buildReportsPrompt } from "../src/lib/reports/tools.ts";
import { courierDisplayName } from "../src/lib/auth/courier.ts";
import { accountByCredentials, accountByRole, DEMO_ACCOUNTS, toDemoUser } from "../src/lib/demo/users.ts";
import type { ReportData } from "../src/lib/reports/data.ts";

const NOW = new Date("2026-10-11T15:00:00.000Z");

const DATA: ReportData = {
  orders: [
    {
      id: "o1", client_id: "c1", status: "Finalizados", total: 10000, delivery_fee: 800, channel: "web",
      payment_method: "Efectivo", items_desc: "2x Pizza", created_at: "2026-10-10T15:00:00.000Z",
      accepted_at: null, ready_at: null, picked_up_at: null, delivered_at: null,
    },
  ] as unknown as ReportData["orders"],
  reviews: [] as unknown as ReportData["reviews"],
  clients: [] as unknown as ReportData["clients"],
  priceByName: new Map([["Pizza", 5000]]) as unknown as ReportData["priceByName"],
};

function byName(name: string) {
  const tool = buildReportTools(DATA, NOW).find((t) => t.name === name);
  assert.ok(tool, `falta la herramienta ${name}`);
  return tool;
}

describe("herramientas del agente de informes", () => {
  it("expone solo herramientas de lectura, con parámetros cerrados", () => {
    const tools = buildReportTools(DATA, NOW);
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "get_delivery_times",
      "get_new_vs_returning",
      "get_recurring_customers",
      "get_reviews_summary",
      "get_sales_summary",
      "get_top_products",
    ]);
    for (const t of tools) {
      assert.equal((t.parameters as { additionalProperties?: boolean }).additionalProperties, false);
    }
  });

  it("valida los argumentos del modelo: período desconocido o límite fuera de rango", () => {
    assert.throws(() => byName("get_sales_summary").validate({ range: "next_year" }));
    assert.throws(() => byName("get_top_products").validate({ range: "last_7_days", limit: 99 }));
    assert.doesNotThrow(() => byName("get_top_products").validate({ range: "last_7_days" }));
  });

  it("aplica los valores por defecto y devuelve las cifras del período", async () => {
    const tool = byName("get_sales_summary");
    const args = tool.validate({ range: "last_7_days" });
    const result = (await tool.run(args)) as Record<string, unknown>;
    assert.equal(result.key, "last_7_days");
    assert.equal(typeof result.period, "string");
    assert.ok("orders" in result || "revenue" in result || "totalOrders" in result);
  });

  it("todas las herramientas corren sobre datos vacíos sin lanzar", async () => {
    const empty: ReportData = { ...DATA, orders: [], reviews: [] };
    for (const tool of buildReportTools(empty, NOW)) {
      const args = tool.validate({ range: "today" });
      await assert.doesNotReject(tool.run(args), tool.name);
    }
  });

  it("el prompt prohíbe inventar cifras y trata los datos como información, no órdenes", () => {
    const prompt = buildReportsPrompt("domingo 11 de octubre");
    assert.match(prompt, /domingo 11 de octubre/);
    assert.match(prompt, /Nunca inventes/);
    assert.match(prompt, /no instrucciones/);
  });
});

describe("cuentas demo y nombre del repartidor", () => {
  it("resuelve cuentas por rol y por credenciales (email sin distinguir mayúsculas)", () => {
    assert.equal(accountByRole("admin")?.email, "admin@deli-gastro.com");
    assert.equal(accountByRole("otro"), null);
    assert.equal(accountByRole(undefined), null);
    assert.equal(accountByCredentials(" ADMIN@deli-gastro.com ", "demo1234")?.role, "admin");
    assert.equal(accountByCredentials("admin@deli-gastro.com", "mala"), null);
    assert.equal(accountByCredentials("nadie@x.com", "demo1234"), null);
  });

  it("el usuario demo lleva el rol en app_metadata", () => {
    for (const account of DEMO_ACCOUNTS) {
      const user = toDemoUser(account);
      assert.equal(user.app_metadata.role, account.role);
      assert.equal(user.id, account.id);
    }
  });

  it("courierDisplayName prefiere el nombre y cae al email", () => {
    assert.equal(courierDisplayName({ email: "d@x.com", user_metadata: { name: "  Diego Rojas " } }), "Diego Rojas");
    assert.equal(courierDisplayName({ email: "diego@x.com", user_metadata: {} }), "diego");
    assert.equal(courierDisplayName({ email: undefined, user_metadata: {} }), "Repartidor");
  });
});
