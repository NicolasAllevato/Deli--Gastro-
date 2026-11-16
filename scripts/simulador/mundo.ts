/**
 * "Mundo" local del simulador: SQLite con el esquema real de D1 (archivo, no la D1 remota),
 * menú de ejemplo si está vacío, y pedidos falsos (no se crea nada real ni se manda WhatsApp).
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SqlDatabase, SqlStatement, SqlValue, SqlRunResult } from "../../src/lib/data/sql.ts";
import type { OrdersClient, OrderResponse } from "../../workers/whatsapp-bot/src/orders/client.ts";

const ROOT = new URL("../../", import.meta.url);

/** Abre (o crea) la base del simulador y aplica esquema + migraciones que falten. */
export function openSimDb(path: string): SqlDatabase & { raw: DatabaseSync } {
  mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec("PRAGMA foreign_keys = ON;");
  raw.exec("CREATE TABLE IF NOT EXISTS _sim_migraciones (nombre TEXT PRIMARY KEY)");
  const applied = new Set((raw.prepare("SELECT nombre FROM _sim_migraciones").all() as { nombre: string }[]).map((r) => r.nombre));
  const files = [
    ["0001_inicial.sql", new URL("d1/schema/0001_inicial.sql", ROOT)] as const,
    ...readdirSync(new URL("d1/migrations/", ROOT))
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => [f, new URL(`d1/migrations/${f}`, ROOT)] as const),
  ];
  for (const [name, url] of files) {
    if (applied.has(name)) continue;
    raw.exec(readFileSync(url, "utf8"));
    raw.prepare("INSERT INTO _sim_migraciones (nombre) VALUES (?)").run(name);
  }

  const stmt = (sql: string, params: SqlValue[] = []): SqlStatement & { sql: string; params: SqlValue[] } => ({
    sql,
    params,
    bind: (...values: SqlValue[]) => stmt(sql, values),
    first: async <T>() => (raw.prepare(sql).get(...params) as T | undefined) ?? null,
    all: async <T>() => ({ results: raw.prepare(sql).all(...params) as T[] }),
    run: async (): Promise<SqlRunResult> => ({ meta: { changes: Number(raw.prepare(sql).run(...params).changes) } }),
  });
  return {
    raw,
    prepare: (sql: string) => stmt(sql),
    batch: async (statements: SqlStatement[]) => {
      raw.exec("BEGIN");
      try {
        const out = statements.map((s) => {
          const { sql, params } = s as unknown as { sql: string; params: SqlValue[] };
          return { meta: { changes: Number(raw.prepare(sql).run(...params).changes) } };
        });
        raw.exec("COMMIT");
        return out;
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      }
    },
  };
}

/** Menú de ejemplo con nombres "formales": los apodos de los clientes ("la napo") no aparecen a propósito. */
const MENU: Array<[string, string, number]> = [
  ["Pizzas", "Muzzarella grande", 12500],
  ["Pizzas", "Napolitana grande", 14500],
  ["Pizzas", "Jamón y morrones grande", 15500],
  ["Pizzas", "Fugazzeta rellena", 16000],
  ["Pizzas", "Pizza de harina de arroz (sin TACC)", 15000],
  ["Empanadas", "Empanada de carne cortada a cuchillo", 1800],
  ["Empanadas", "Empanada de jamón y queso", 1700],
  ["Empanadas", "Empanada de humita", 1700],
  ["Bebidas", "Coca-Cola 1,5 L", 3500],
  ["Bebidas", "Agua sin gas 500 ml", 1500],
  ["Postres", "Flan casero con dulce de leche", 3800],
];

/** Prepara configuración y menú si la base está vacía. No toca nada que ya exista. */
export function seedWorld(db: { raw: DatabaseSync }): void {
  const cfg = db.raw.prepare("INSERT INTO global_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value");
  const config: Record<string, unknown> = {
    agente_activo: true,
    bot_orders_enabled: true,
    negocio_nombre: "La Gambeta",
    agente_nombre: "Gambi",
    horario_apertura: "00:00",
    horario_cierre: "23:59",
    tiempo_entrega_min: 40,
    modo_pausa: false,
  };
  for (const [key, value] of Object.entries(config)) cfg.run(key, JSON.stringify(value));

  const products = db.raw.prepare("SELECT count(*) AS n FROM products WHERE is_active = 1").get() as { n: number };
  if (products.n === 0) {
    const cats = new Map<string, string>();
    for (const [cat, name, price] of MENU) {
      if (!cats.has(cat)) {
        const id = `sim-cat-${cats.size + 1}`;
        db.raw.prepare("INSERT INTO categories (id, name) VALUES (?, ?)").run(id, cat);
        cats.set(cat, id);
      }
      db.raw
        .prepare("INSERT INTO products (id, category_id, name, price_cents, is_active, show_in_portal) VALUES (?, ?, ?, ?, 1, 1)")
        .run(`sim-p-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, cats.get(cat) ?? null, name, price * 100);
    }
  }
  const zones = db.raw.prepare("SELECT count(*) AS n FROM delivery_zones").get() as { n: number };
  if (zones.n === 0) {
    const z = db.raw.prepare("INSERT INTO delivery_zones (id, name, shape, fee_cents, min_order_cents, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)");
    z.run("sim-z-1", "Palermo", JSON.stringify({ type: "circle", lat: -34.58, lng: -58.42, radius_km: 2 }), 150000, 1000000, 0);
    z.run("sim-z-2", "Belgrano", JSON.stringify({ type: "circle", lat: -34.56, lng: -58.45, radius_km: 2 }), 200000, 1200000, 1);
  }
}

/** Menú en texto para el juez (precio real, para detectar precios inventados). */
export function menuText(db: { raw: DatabaseSync }): string {
  const rows = db.raw
    .prepare("SELECT name, price_cents FROM products WHERE is_active = 1 AND COALESCE(show_in_portal, 1) = 1 ORDER BY name LIMIT 200")
    .all() as { name: string; price_cents: number }[];
  return rows.map((r) => `- ${r.name}: $${(r.price_cents / 100).toLocaleString("es-AR")}`).join("\n");
}

/** Pedidos en memoria por conversación: cotiza con los precios del menú local, nunca escribe pedidos. */
export function fakeOrders(db: { raw: DatabaseSync }): OrdersClient {
  const state = new Map<string, "cotizado" | "esperando_pago" | "cancelado">();
  const ok = (data: Record<string, unknown>): OrderResponse => ({ ok: true, status: 200, data: { ok: true, ...data } });
  const fail = (status: number, code: string, error: string): OrderResponse => ({ ok: false, kind: "api", status, code, error });
  return {
    async quote(body) {
      if (!body.address?.trim()) return fail(400, "missing_address", "Falta la dirección.");
      const lines = [];
      for (const item of body.items ?? []) {
        const p = db.raw.prepare("SELECT name, price_cents FROM products WHERE id = ? AND is_active = 1").get(item.product_id) as
          | { name: string; price_cents: number }
          | undefined;
        if (!p) return fail(400, "unknown_product", `Producto inexistente: ${item.product_id}`);
        lines.push({ name: p.name, qty: item.qty, price: p.price_cents / 100 });
      }
      if (lines.length === 0) return fail(400, "empty_order", "El pedido está vacío.");
      const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
      state.set(body.conversationId, "cotizado");
      return ok({ lines, subtotal, delivery_fee: 1500, total: subtotal + 1500, resolved_address: body.address.trim() });
    },
    async confirm(body) {
      if (state.get(body.conversationId) !== "cotizado") return fail(409, "no_quote", "No hay cotización vigente.");
      state.set(body.conversationId, "esperando_pago");
      return ok({ awaiting_payment: true, payment_url: "https://mpago.la/simulacion", total: null });
    },
    async cancel(body) {
      if (!state.has(body.conversationId)) return fail(404, "no_order", "No hay pedido en curso.");
      state.set(body.conversationId, "cancelado");
      return ok({});
    },
    async status(body) {
      const s = state.get(body.conversationId);
      return s ? ok({ found: true, status: s, awaiting_payment: s === "esperando_pago", payment_url: s === "esperando_pago" ? "https://mpago.la/simulacion" : null }) : ok({ found: false });
    },
  };
}
