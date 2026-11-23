/**
 * "Mundo" local del simulador: SQLite con el esquema real de D1 (archivo, no la D1 remota),
 * menú de ejemplo si está vacío, y pedidos falsos (no se crea nada real ni se manda WhatsApp).
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SqlDatabase, SqlStatement, SqlValue, SqlRunResult } from "../../src/lib/data/sql.ts";
import type { OrdersClient, OrderResponse } from "../../workers/whatsapp-bot/src/orders/client.ts";
import { buildPackContext, packEmpanadas } from "../../src/lib/agent/empanadas.ts";
import type { ModifierOptionRow } from "../../src/lib/order-options.ts";

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
  ["Productos genéricos", "Docena de empanadas", 36000],
  ["Bebidas", "Coca-Cola 1,5 L", 3500],
  ["Bebidas", "Agua sin gas 500 ml", 1500],
  ["Postres", "Flan casero con dulce de leche", 3800],
  ["Empanadas", "Empanada de pollo", 1700],
  ["Empanadas", "Empanada de verdura", 1700],
  ["Empanadas", "Empanada de cebolla y queso", 1700],
  ["Empanadas", "Empanada de roquefort y jamón", 1800],
  ["Bebidas", "Pepsi 1,5 L", 3500],
  ["Cafetería", "Café doble", 4300],
  ["Cafetería", "Medialuna de manteca", 1800],
  ["Cafetería", "Tostado de jamón y queso", 6000],
  ["Postres", "Budín de pan", 9600],
  ["Pizzas", "Calabresa grande", 33000],
  // Variantes parecidas (como en producción): con/sin gas, grande/porción, fainá. Sirven para los guiones 50-52.
  ["Bebidas", "Agua con gas 500 ml", 1500],
  ["Pizzas", "Porción de muzzarella", 3600],
  ["Pizzas", "Porción de fugazzeta", 4200],
  ["Pizzas", "Porción de jamón y morrones", 4200],
  ["Pizzas", "Fainá", 1800],
];

/** id Fudo de la docena (oculta del menú) y de las 7 empanadas sueltas, igual que en producción. */
const DOCENA_NAME = "Docena de empanadas";
const DOCENA_FUDO_ID = 212;
const GUSTOS: ReadonlyArray<{ product: string; fudoId: number; optionId: number; saborFudoId: number; label: string }> = [
  { product: "Empanada de carne cortada a cuchillo", fudoId: 31, optionId: 2, saborFudoId: 200, label: "Carne cortada a cuchillo" },
  { product: "Empanada de pollo", fudoId: 32, optionId: 4, saborFudoId: 197, label: "Pollo" },
  { product: "Empanada de jamón y queso", fudoId: 33, optionId: 1, saborFudoId: 193, label: "Jamón y queso" },
  { product: "Empanada de verdura", fudoId: 34, optionId: 5, saborFudoId: 202, label: "Verdura" },
  { product: "Empanada de cebolla y queso", fudoId: 35, optionId: 3, saborFudoId: 201, label: "Cebolla y queso" },
  { product: "Empanada de roquefort y jamón", fudoId: 97, optionId: 6, saborFudoId: 192, label: "Roquefort y jamón" },
  { product: "Empanada de humita", fudoId: 98, optionId: 7, saborFudoId: 196, label: "Humita" },
];

/** UUID fijo por posición del menú de ejemplo (formato que exige el bot). */
export const simProductId = (index: number): string => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;

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
        // UUID: el bot valida product_id como UUID (parseQuoteArgs); un id de otro formato rompe la cotización.
        .run(simProductId(MENU.findIndex(([, n]) => n === name)), cats.get(cat) ?? null, name, price * 100);
    }
  }
  seedDocena(db);
  const zones = db.raw.prepare("SELECT count(*) AS n FROM delivery_zones").get() as { n: number };
  if (zones.n === 0) {
    const z = db.raw.prepare("INSERT INTO delivery_zones (id, name, shape, fee_cents, min_order_cents, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)");
    z.run("sim-z-1", "Palermo", JSON.stringify({ type: "circle", lat: -34.58, lng: -58.42, radius_km: 2 }), 150000, 1000000, 0);
    z.run("sim-z-2", "Belgrano", JSON.stringify({ type: "circle", lat: -34.56, lng: -58.45, radius_km: 2 }), 200000, 1200000, 1);
  }
}

/**
 * Docena de empanadas oculta (fudo 212), fudo_id de las 7 sueltas, grupo «Elige tu Relleno» con sus opciones y la config
 * del empaquetado. Idempotente; también arregla una base vieja del simulador (producto «empanadas»).
 */
function seedDocena(db: { raw: DatabaseSync }): void {
  const { raw } = db;
  const cat = (raw.prepare("SELECT id FROM categories WHERE name = 'Productos genéricos'").get() as { id: string } | undefined)?.id ?? "sim-cat-generico";
  raw.prepare("INSERT OR IGNORE INTO categories (id, name) VALUES (?, 'Productos genéricos')").run(cat);
  const legacy = raw.prepare("SELECT id FROM products WHERE name = 'empanadas' AND fudo_id IS NULL").get() as { id: string } | undefined;
  if (legacy) raw.prepare("UPDATE products SET name = ?, price_cents = ?, category_id = ? WHERE id = ?").run(DOCENA_NAME, 3_600_000, cat, legacy.id);
  const docena = raw.prepare("SELECT id FROM products WHERE name = ?").get(DOCENA_NAME) as { id: string } | undefined;
  if (docena) raw.prepare("UPDATE products SET fudo_id = ?, show_in_portal = 0, is_active = 1 WHERE id = ?").run(DOCENA_FUDO_ID, docena.id);
  for (const g of GUSTOS) raw.prepare("UPDATE products SET fudo_id = ? WHERE name = ? AND fudo_id IS NULL").run(g.fudoId, g.product);

  raw.prepare("INSERT OR IGNORE INTO fudo_modifier_groups (fudo_id, name, min_qty, max_qty, required) VALUES (1, 'Elige tu Relleno', 12, 12, 1)").run();
  for (const g of GUSTOS) {
    raw.prepare("INSERT OR IGNORE INTO fudo_modifier_options (fudo_id, group_fudo_id, product_fudo_id, name, price_cents, position) VALUES (?, 1, ?, ?, 0, ?)").run(g.optionId, g.saborFudoId, g.label, g.optionId);
  }
  raw.prepare("INSERT OR IGNORE INTO fudo_product_groups (product_fudo_id, group_fudo_id) VALUES (?, 1)").run(DOCENA_FUDO_ID);
  const cfg = raw.prepare("INSERT INTO global_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value");
  cfg.run("docena_fudo_id", JSON.stringify(DOCENA_FUDO_ID));
  cfg.run("docena_unidades", JSON.stringify(12));
  cfg.run("empanada_gustos_map", JSON.stringify(Object.fromEntries(GUSTOS.map((g) => [String(g.fudoId), g.saborFudoId]))));
}

/** Menú en texto para el juez (precio real, para detectar precios inventados). */
export function menuText(db: { raw: DatabaseSync }): string {
  const rows = db.raw
    .prepare("SELECT name, price_cents FROM products WHERE is_active = 1 AND COALESCE(show_in_portal, 1) = 1 ORDER BY name LIMIT 200")
    .all() as { name: string; price_cents: number }[];
  return rows.map((r) => `- ${r.name}: $${(r.price_cents / 100).toLocaleString("es-AR")}`).join("\n");
}

/** Estado de un pedido simulado. `pagado` = ya pagado y en "Recibidos" (como un pedido real recién pagado). */
type FakeState = "cotizado" | "esperando_pago" | "pagado" | "cancelado";

export interface FakeOrders extends OrdersClient {
  /** Siembra un pedido ya pagado hace `minutesAgo` minutos (escenario "ya pagué y quiero cancelar"). */
  seedPaid(conversationId: string, minutesAgo: number): void;
  /** El cliente simulado dice que pagó: si había un link de pago pendiente, Mercado Pago lo acredita (como en la vida real). */
  markPaid(conversationId: string): boolean;
}

/** Contexto de empaquetado de docenas desde la base del simulador (null si falta la config o la docena). */
function packContextFor(db: { raw: DatabaseSync }) {
  const config: Record<string, unknown> = {};
  for (const r of db.raw.prepare("SELECT key, value FROM global_config WHERE key IN ('docena_fudo_id', 'docena_unidades', 'empanada_gustos_map')").all() as { key: string; value: string }[]) config[r.key] = JSON.parse(r.value);
  // Mismos tres valores que lee el servidor (docenaConfigFrom); acá siempre vienen ya parseados de la semilla.
  if (typeof config.docena_fudo_id !== "number" || typeof config.docena_unidades !== "number" || typeof config.empanada_gustos_map !== "object" || config.empanada_gustos_map === null) return null;
  const cfg = { docenaFudoId: config.docena_fudo_id, docenaUnits: config.docena_unidades, gustosMap: config.empanada_gustos_map as Record<string, number> };
  const products = db.raw.prepare("SELECT id, fudo_id, is_active FROM products WHERE fudo_id IS NOT NULL").all() as { id: string; fudo_id: number; is_active: number }[];
  const docenaOptions = db.raw
    .prepare("SELECT o.fudo_id, o.group_fudo_id, o.product_fudo_id, o.name, o.price_cents, o.position, o.is_active FROM fudo_modifier_options o JOIN fudo_product_groups g ON g.group_fudo_id = o.group_fudo_id WHERE g.product_fudo_id = ?")
    .all(cfg.docenaFudoId) as unknown as ModifierOptionRow[];
  return buildPackContext({ ...cfg, products, docenaOptions });
}

/**
 * Pedidos en memoria por conversación: cotiza con los precios del menú local, nunca escribe pedidos.
 * Códigos y mensajes iguales a los del servidor real (src/lib/bot-internal + order-actions): así el bot ve lo mismo.
 */
export function fakeOrders(db: { raw: DatabaseSync }): FakeOrders {
  const state = new Map<string, { s: FakeState; at: number }>();
  const ok = (data: Record<string, unknown>): OrderResponse => ({ ok: true, status: 200, data: { ok: true, ...data } });
  const fail = (status: number, code: string, error: string): OrderResponse => ({ ok: false, kind: "api", status, code, error });
  const set = (id: string, s: FakeState) => state.set(id, { s, at: Date.now() });
  return {
    seedPaid(conversationId, minutesAgo) {
      state.set(conversationId, { s: "pagado", at: Date.now() - minutesAgo * 60_000 });
    },
    markPaid(conversationId) {
      if (state.get(conversationId)?.s !== "esperando_pago") return false;
      set(conversationId, "pagado");
      return true;
    },
    async quote(body) {
      if (!body.address?.trim()) return fail(400, "invalid", "Falta la dirección.");
      // Igual que el servidor real: las empanadas sueltas se empaquetan en docenas antes de cotizar.
      const items = packEmpanadas(body.items ?? [], packContextFor(db));
      const lines = [];
      for (const item of items) {
        const p = db.raw.prepare("SELECT name, price_cents FROM products WHERE id = ? AND is_active = 1").get(item.product_id) as
          | { name: string; price_cents: number }
          | undefined;
        if (!p) return fail(409, "product_unavailable", "Ese producto no está disponible.");
        const options = (item.options ?? []).map((o) => ({
          name: (db.raw.prepare("SELECT name FROM fudo_modifier_options WHERE fudo_id = ?").get(o.option_id) as { name: string } | undefined)?.name ?? "opción " + o.option_id,
          qty: o.qty,
        }));
        lines.push({ name: p.name, qty: item.qty, price: p.price_cents / 100, ...(options.length ? { options } : {}) });
      }
      if (lines.length === 0) return fail(400, "invalid", "El pedido está vacío.");
      const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
      // Una cotización nueva no pisa un pedido ya pagado (en el real, el pagado sigue y esto es un borrador aparte).
      if (state.get(body.conversationId)?.s !== "pagado") set(body.conversationId, "cotizado");
      return ok({ lines, subtotal, delivery_fee: 1500, total: subtotal + 1500, resolved_address: body.address.trim() });
    },
    async confirm(body) {
      if (state.get(body.conversationId)?.s !== "cotizado") return fail(409, "no_draft", "No hay un resumen vigente.");
      set(body.conversationId, "esperando_pago");
      return ok({ awaiting_payment: true, payment_url: "https://mpago.la/simulacion", total: null });
    },
    async cancel(body) {
      const cur = state.get(body.conversationId);
      if (cur?.s === "esperando_pago") {
        set(body.conversationId, "cancelado");
        return ok({ note: "Se canceló el pago pendiente. No se cobró nada." });
      }
      if (cur?.s === "pagado") {
        if (Date.now() - cur.at > 15 * 60_000) return fail(409, "rejected", "Pasaron más de 15 minutos: ya no se puede cancelar.");
        set(body.conversationId, "cancelado");
        return ok({});
      }
      if (cur?.s === "cancelado") return fail(409, "rejected", "El pedido ya está cancelado.");
      return fail(409, "rejected", "No encontré un pedido para cancelar.");
    },
    async status(body) {
      const cur = state.get(body.conversationId);
      // Un resumen sin confirmar no es un pedido (igual que el servidor real).
      if (!cur || cur.s === "cotizado") return ok({ found: false });
      if (cur.s === "esperando_pago") return ok({ found: true, awaiting_payment: true, total: null, payment_url: "https://mpago.la/simulacion" });
      const minutes = Math.round((Date.now() - cur.at) / 60_000);
      return ok({ found: true, order_code: "#SIM00001", status: cur.s === "pagado" ? "Recibidos" : "Cancelado", items: "pedido simulado", total: 15800, courier: null, minutes_since_order: minutes });
    },
  };
}
