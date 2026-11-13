/**
 * Tanda 4: recorte de columnas del pedido que recibe el cliente.
 * Falla si una pantalla del cliente pide un campo que la API ya no devuelve,
 * si Supabase y D1 difieren, o si vuelve a salir un campo interno.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CLIENT_ORDER_FIELDS, CLIENT_ORDER_EXCLUDED, CLIENT_ORDER_SELECT, CLIENT_ORDER_D1_COLUMNS,
} from "../src/lib/data/client-order-fields.ts";
import { createTestDb, seed, actors } from "./helpers/sqlite-d1.ts";
import * as cv from "../src/lib/data/client-views.ts";

const FIELDS = new Set<string>(CLIENT_ORDER_FIELDS);
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/** Campos de pedido que lee cada pantalla del cliente (variable que contiene el pedido → archivo). */
const SCREENS: { file: string; vars: string[] }[] = [
  { file: "src/app/cliente/pedidos/[id]/OrderTracker.tsx", vars: ["order", "initial"] },
  { file: "src/app/cliente/pedidos/[id]/page.tsx", vars: ["order"] },
  { file: "src/app/cliente/pedidos/page.tsx", vars: ["pedido", "o"] },
  { file: "src/app/cliente/page.tsx", vars: ["activeOrder"] },
];

/** Propiedades que no son columnas (métodos o campos calculados de la respuesta). */
const NOT_COLUMNS = new Set(["length", "map", "filter", "data", "error"]);

function usedFields(src: string, vars: string[]): string[] {
  const out = new Set<string>();
  for (const v of vars) {
    for (const m of src.matchAll(new RegExp(`\\b${v}\\??\\.([a-z_]+)\\b`, "g"))) {
      if (!NOT_COLUMNS.has(m[1])) out.add(m[1]);
    }
  }
  return [...out];
}

describe("cada campo que usa una pantalla del cliente está en la lista", () => {
  for (const { file, vars } of SCREENS) {
    it(file, () => {
      const used = usedFields(read(file), vars);
      assert.ok(used.length >= 2, `el escaneo encontró campos en ${file}: ${used.join(", ")}`);
      const missing = used.filter((f) => !FIELDS.has(f));
      assert.deepEqual(missing, [], `la pantalla usa campos que la API no devuelve: ${missing.join(", ")}`);
    });
  }
  it("TrackedOrder (seguimiento en vivo) solo usa campos de la lista", () => {
    const src = read("src/app/cliente/pedidos/[id]/OrderTracker.tsx");
    const block = /export interface TrackedOrder \{([\s\S]*?)\}/.exec(src)?.[1] ?? "";
    const keys = [...block.matchAll(/^\s*([a-z_]+)\??:/gm)].map((m) => m[1]);
    assert.ok(keys.length >= 10, "se encontró la interfaz");
    assert.deepEqual(keys.filter((k) => !FIELDS.has(k)), []);
  });
  it("lo que usan el pedido en curso y los puntos queda incluido", () => {
    for (const f of ["id", "status", "items_desc", "total", "delivery_fee", "delivery_address", "payment_method", "notes", "courier_name", "created_at", "points_earned"]) {
      assert.ok(FIELDS.has(f), f);
    }
  });
});

describe("misma lista en Supabase y en D1", () => {
  it("Supabase selecciona exactamente la lista", () => {
    assert.deepEqual(CLIENT_ORDER_SELECT.split(", "), [...CLIENT_ORDER_FIELDS]);
  });
  it("D1 selecciona la misma lista (montos en centavos)", () => {
    const cols = CLIENT_ORDER_D1_COLUMNS.split(", ").map((c) => c.replace(/^o\./, "").replace(/_cents$/, ""));
    assert.deepEqual(cols, [...CLIENT_ORDER_FIELDS]);
  });
  it("la vista D1 devuelve exactamente esos campos", async () => {
    const db = createTestDb();
    seed(db);
    const [o] = await cv.listOwnOrders(db, actors.ana);
    assert.deepEqual(Object.keys(o).sort(), [...CLIENT_ORDER_FIELDS].sort());
    const one = await cv.getOwnOrder(db, actors.ana, "o-ana-1");
    assert.deepEqual(Object.keys(one ?? {}).sort(), [...CLIENT_ORDER_FIELDS].sort());
  });
  it("todas las columnas existen en el esquema D1", () => {
    const db = createTestDb();
    assert.doesNotThrow(() => db.raw.prepare(`SELECT ${CLIENT_ORDER_D1_COLUMNS} FROM orders o`).all());
  });
});

describe("los internos no se devuelven", () => {
  it("ninguna columna excluida está en la lista", () => {
    assert.deepEqual(CLIENT_ORDER_EXCLUDED.filter((f) => FIELDS.has(f)), []);
  });
  it("lista + excluidos cubren todas las columnas de orders en D1", () => {
    const db = createTestDb();
    const cols = (db.raw.prepare("PRAGMA table_info(orders)").all() as { name: string }[])
      .map((c) => c.name.replace(/_cents$/, ""));
    const known = new Set<string>([...CLIENT_ORDER_FIELDS, ...CLIENT_ORDER_EXCLUDED]);
    assert.deepEqual(cols.filter((c) => !known.has(c)), [], "columna nueva sin clasificar: decidir si el cliente la ve");
  });
});
