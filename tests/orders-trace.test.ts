/**
 * Rastreo completo del pedido en el admin: falla si aparece una columna de
 * `orders` que el detalle no muestra, y verifica el formato de los valores.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CLIENT_ORDER_FIELDS, CLIENT_ORDER_EXCLUDED } from "../src/lib/data/client-order-fields.ts";
import { ORDER_TRACE_KEYS, ORDER_TRACE_SECTIONS, EMPTY, formatTraceValue, prettyJson, tracePoints } from "../src/lib/orders-trace.ts";
import { createTestDb } from "./helpers/sqlite-d1.ts";

/** Columnas que existen solo en D1 (todavía no en Supabase): el detalle lee Supabase. */
const D1_ONLY = new Set([
  "courier_user_id",
  "payment_intent_id",
  // Venta en Fudo (migración D1 0007): el admin la ve en /admin/fudo (ventas pendientes).
  "fudo_sale_id",
  "fudo_sale_sync",
  "fudo_sale_error",
  "fudo_sale_claimed_at",
  "fudo_sale_paid_at",
  "fudo_sale_closed_at",
  "fudo_sale_canceled_at",
]);
const TRACE = new Set(ORDER_TRACE_KEYS);

/** Columnas de `orders` en Supabase según src/types/database.ts (Row). */
function supabaseOrderColumns(): string[] {
  const src = readFileSync(new URL("../src/types/database.ts", import.meta.url), "utf8");
  const block = /\borders: \{\s*Row: \{([\s\S]*?)\n\s*\}/.exec(src)?.[1] ?? "";
  return [...block.matchAll(/^\s*([a-z_]+)\??:/gm)].map((m) => m[1]);
}

describe("el detalle del admin muestra todas las columnas de orders", () => {
  it("todas las de la lista del cliente + las excluidas (sin las solo-D1)", () => {
    const all = [...CLIENT_ORDER_FIELDS, ...CLIENT_ORDER_EXCLUDED].filter((c) => !D1_ONLY.has(c));
    assert.deepEqual(all.filter((c) => !TRACE.has(c)), []);
    assert.equal(new Set(all).size, 37);
  });
  it("todas las columnas de orders en el esquema D1 (sin las solo-D1)", () => {
    const db = createTestDb();
    const cols = (db.raw.prepare("PRAGMA table_info(orders)").all() as { name: string }[])
      .map((c) => c.name.replace(/_cents$/, ""))
      .filter((c) => !D1_ONLY.has(c));
    assert.deepEqual(cols.filter((c) => !TRACE.has(c)), [], "columna nueva de orders sin mostrar en el rastreo");
  });
  it("todas las columnas del tipo Row de Supabase", () => {
    const cols = supabaseOrderColumns();
    assert.ok(cols.length >= 30, `se leyó el tipo: ${cols.length}`);
    assert.deepEqual(cols.filter((c) => !TRACE.has(c)), []);
  });
  it("sin duplicados ni campos inventados", () => {
    assert.equal(TRACE.size, ORDER_TRACE_KEYS.length);
    const known = new Set<string>([...CLIENT_ORDER_FIELDS, ...CLIENT_ORDER_EXCLUDED]);
    assert.deepEqual(ORDER_TRACE_KEYS.filter((k) => !known.has(k)), []);
  });
  it("las cuatro secciones pedidas", () => {
    assert.deepEqual(ORDER_TRACE_SECTIONS.map((s) => s.id), ["pedido", "tiempos", "entrega", "fudo"]);
    const fudo = ORDER_TRACE_SECTIONS.find((s) => s.id === "fudo")!.fields.map((f) => f.key);
    assert.equal(fudo.filter((k) => k.startsWith("fudo_")).length, 10);
  });
});

describe("formato de valores", () => {
  it("vacíos se muestran como —, nunca se ocultan", () => {
    for (const kind of ["text", "money", "date", "bool", "json", "number", "coord", "meters", "client", "error"] as const) {
      assert.equal(formatTraceValue(null, kind), EMPTY);
      assert.equal(formatTraceValue(undefined, kind), EMPTY);
      assert.equal(formatTraceValue("  ", kind), EMPTY);
    }
  });
  it("cero y false no son vacíos", () => {
    assert.equal(formatTraceValue(0, "number"), "0");
    assert.equal(formatTraceValue(false, "bool"), "No");
    assert.equal(formatTraceValue(true, "bool"), "Sí");
  });
  it("JSON legible (objeto o string con JSON) y texto que no es JSON queda igual", () => {
    assert.equal(prettyJson([{ id: 1, amount: 100 }]), '[\n  {\n    "id": 1,\n    "amount": 100\n  }\n]');
    assert.equal(prettyJson('{"a":1}'), '{\n  "a": 1\n}');
    assert.equal(prettyJson("Efectivo"), "Efectivo");
  });
  it("coordenadas, metros y fecha en hora argentina", () => {
    assert.equal(formatTraceValue(-34.6037, "coord"), "-34.603700");
    assert.equal(formatTraceValue(12.6, "meters"), "13 m");
    assert.match(formatTraceValue("2026-11-13T02:30:00.000Z", "date"), /12\/11\/2026|12\/11\/26/);
  });
  it("puntos del mapa solo con coordenadas válidas", () => {
    assert.deepEqual(tracePoints({ delivery_lat: -34.6, delivery_lng: -58.4, delivered_lat: null, delivered_lng: -58 }), {
      requested: { lat: -34.6, lng: -58.4 },
      delivered: null,
    });
    assert.deepEqual(tracePoints({}), { requested: null, delivered: null });
  });
});
