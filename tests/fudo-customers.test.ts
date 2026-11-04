import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { parseFudoCustomers, planCustomersImport } = await import("../workers/fudo-gateway/src/customers.ts");

const raw = (id: string, attrs: Record<string, unknown>) => ({ type: "Customer", id, attributes: { active: true, ...attrs } });

describe("parseFudoCustomers", () => {
  it("lee nombre, teléfono, email y dirección (array JSON) y descarta sin nombre", () => {
    const out = parseFudoCustomers({
      data: [
        raw("7", { name: " Ana ", phone: "+54 9 11 5555-1234", email: "ana@x.com", address: '["Corrientes","1234","","CABA"]' }),
        raw("8", { name: "", phone: "1" }),
      ],
    });
    assert.deepEqual(out, [{ id: 7, name: "Ana", phone: "+54 9 11 5555-1234", email: "ana@x.com", address: "Corrientes 1234, CABA", active: true }]);
  });
});

const fudo = (id: number, name: string, phone: string | null, extra: Partial<{ email: string; address: string; active: boolean }> = {}) => ({
  id, name, phone, email: extra.email ?? null, address: extra.address ?? null, active: extra.active ?? true,
});
const client = (id: string, name: string, phone: string | null, extra: Record<string, unknown> = {}) => ({
  id, name, phone, email: null, address: null, fudo_customer_id: null, ...extra,
});

describe("planCustomersImport", () => {
  it("crea los clientes nuevos de Fudo con source fudo", () => {
    const plan = planCustomersImport({ customers: [fudo(7, "Ana", "1155551234", { email: "a@x.com" })], existing: [] });
    assert.deepEqual(plan.inserts, [{ fudo_customer_id: 7, name: "Ana", phone: "1155551234", email: "a@x.com", address: null, source: "fudo" }]);
  });

  it("empareja por teléfono con un cliente de la app y solo completa lo vacío (no pisa)", () => {
    const plan = planCustomersImport({
      customers: [fudo(7, "Ana Fudo", "+54 9 11 5555-1234", { email: "a@x.com", address: "Fudo 1" })],
      existing: [client("c1", "Ana App", "11 5555 1234", { address: "Mi casa" })],
    });
    assert.equal(plan.inserts.length, 0);
    assert.deepEqual(plan.updates, [{ id: "c1", fudo_customer_id: 7, email: "a@x.com" }]);
  });

  it("es idempotente: un cliente ya vinculado sin campos vacíos no genera cambios", () => {
    const plan = planCustomersImport({
      customers: [fudo(7, "Ana", "1155551234", { email: "a@x.com" })],
      existing: [client("c1", "Ana", "1155551234", { fudo_customer_id: 7, email: "a@x.com", address: "x" })],
    });
    assert.deepEqual(plan, { inserts: [], updates: [] });
  });

  it("no crea inactivos ni clientes sin teléfono ni email (no sirven para contactar)", () => {
    const plan = planCustomersImport({
      customers: [fudo(1, "Viejo", "1155550000", { active: false }), fudo(2, "Sin datos", null)],
      existing: [],
    });
    assert.equal(plan.inserts.length, 0);
  });

  it("no vincula dos clientes de Fudo al mismo cliente de la app ni crea duplicados por teléfono", () => {
    const plan = planCustomersImport({
      customers: [fudo(7, "Ana", "1155551234"), fudo(8, "Ana otra vez", "+5491155551234")],
      existing: [],
    });
    assert.equal(plan.inserts.length, 1);
    assert.equal(plan.inserts[0].fudo_customer_id, 7);
  });
});
