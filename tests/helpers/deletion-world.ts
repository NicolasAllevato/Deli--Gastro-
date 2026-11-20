/**
 * Mundo de prueba de la eliminación de usuarios: D1 real (node:sqlite) y Better Auth real, con el personal del local (dueño principal,
 * otro dueño, gerente, cajero) y un historial completo (clientes, pedidos, puntos, reseñas, pagos, WhatsApp, reclamos, auditoría,
 * constancias legales). Eliminar a un usuario no puede cambiar ni una fila de ese historial.
 */
import type { DatabaseSync } from "node:sqlite";
import { createTestDb } from "./sqlite-d1.ts";
import { createAuth } from "../../src/lib/data/auth.ts";

export const BASE = "https://opsyndely.la-gambeta.com";
export const PASSWORD = "clave-segura-123";
export const SUPER_EMAIL = "dueno@local.test";
export const SECRET = "secreto-de-prueba-de-32-caracteres-o-mas";
const NOW = "2026-11-10T15:00:00.000Z";

export function setup(superOwnerEmail: string | null = SUPER_EMAIL, hashSecret: string | null = SECRET) {
  const db = createTestDb();
  const auth = createAuth({ database: db.raw, secret: crypto.randomUUID() + crypto.randomUUID(), baseURL: BASE });
  return { db, auth, opts: { superOwnerEmail, hashSecret } };
}
export type World = ReturnType<typeof setup>;

export const hashPassword = async (world: Pick<World, "auth">, password: string): Promise<string> => (await world.auth.$context).password.hash(password);

export const STAFF = [
  { id: "dueno", email: SUPER_EMAIL, name: "Dueña Principal", staffRole: "admin" },
  { id: "socio", email: "socio@local.test", name: "Socio Dueño", staffRole: "admin" },
  { id: "gerente1", email: "gerente@local.test", name: "Gerente Uno", staffRole: "gerente" },
  { id: "cajero1", email: "cajero@local.test", name: "Cajero Uno", staffRole: "cajero" },
] as const;

/** El personal, cada uno con su contraseña (PASSWORD) y una sesión abierta. */
export async function seedStaff(world: World): Promise<void> {
  const { raw } = world.db;
  for (const u of STAFF) {
    raw.prepare(`INSERT INTO "user" (id, name, email, emailVerified, role, staff_role, banned, createdAt, updatedAt) VALUES (?, ?, ?, 1, 'admin', ?, 0, ?, ?)`).run(u.id, u.name, u.email, u.staffRole, NOW, NOW);
    raw.prepare(`INSERT INTO "account" (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, 'credential', ?, ?, ?, ?)`).run(`a-${u.id}`, u.id, u.id, await hashPassword(world, PASSWORD), NOW, NOW);
    raw.prepare(`INSERT INTO "session" (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId) VALUES (?, '2099-01-01', ?, ?, ?, '203.0.113.5', 'UA', ?)`).run(`s-${u.id}`, `tok-${u.id}`, NOW, NOW, u.id);
  }
  raw.prepare(`INSERT INTO "verification" (id, identifier, value, expiresAt) VALUES ('v-g1', 'gerente@local.test', 'token-g1', '2099-01-01')`).run();
  raw.prepare(`INSERT INTO "verification" (id, identifier, value, expiresAt) VALUES ('v-g2', 'reset-password:abc', 'gerente1', '2099-01-01')`).run();
  raw.prepare(`INSERT INTO "verification" (id, identifier, value, expiresAt) VALUES ('v-s1', 'socio@local.test', 'token-s1', '2099-01-01')`).run();
}

/** Historial: un cliente con cuenta, un cliente atado al GERENTE (compró como cliente), un repartidor y todo lo que cuelga de ellos. */
export function seedHistory(world: World): void {
  const run = (sql: string, ...params: (string | number | null)[]) => world.db.raw.prepare(sql).run(...params);
  run(`INSERT INTO "user" (id, name, email, emailVerified, role, createdAt, updatedAt) VALUES ('u-cli', 'Cliente Uno', 'cliente@example.test', 1, 'cliente', ?, ?)`, NOW, NOW);
  run(`INSERT INTO "user" (id, name, email, emailVerified, role, createdAt, updatedAt) VALUES ('u-rep', 'Repartidor Uno', 'repartidor-uno@repartidores.dely.opsyn.app', 1, 'repartidor', ?, ?)`, NOW, NOW);
  run(`INSERT INTO couriers (user_id, name, pin_hash) VALUES ('u-rep', 'Repartidor Uno', 'hash-rep')`);
  run(`INSERT INTO courier_locations (user_id, courier_name, lat, lng) VALUES ('u-rep', 'Repartidor Uno', -34.6, -58.4)`);
  run(`INSERT INTO courier_shifts (id, user_id, courier_name, shift_day, status) VALUES ('cs-1', 'u-rep', 'Repartidor Uno', '2026-11-02', 'approved')`);
  run(`INSERT INTO clients (id, user_id, name, phone, phone_digits, address, email) VALUES ('c-cli', 'u-cli', 'Cliente Uno', '+54 9 11 5555-0101', '1155550101', 'Calle 1', 'cliente@example.test')`);
  run(`INSERT INTO clients (id, user_id, name, phone, phone_digits, address, email) VALUES ('c-ger', 'gerente1', 'Gerente Uno', '+54 9 11 6666-0202', '1166660202', 'Calle 2', 'gerente@local.test')`);
  run(`INSERT INTO orders (id, client_id, status, items_desc, total_cents, payment_method, created_at, customer_name, delivery_address, notes, courier_name, courier_user_id)
       VALUES ('o-1', 'c-cli', 'Finalizados', '2x Muzza', 1250050, 'Mercado Pago', '2026-11-01T20:00:00.000Z', 'Cliente Uno', 'Calle 1', 'timbre', 'Repartidor Uno', 'u-rep')`);
  run(`INSERT INTO orders (id, client_id, status, items_desc, total_cents, payment_method, created_at, customer_name, delivery_address) VALUES ('o-2', 'c-ger', 'Finalizados', '1x Flan', 300000, 'Efectivo', '2026-11-02T20:00:00.000Z', 'Gerente Uno', 'Calle 2')`);
  run(`INSERT INTO order_items (id, order_id, name, qty, unit_price_cents, fudo_comment) VALUES ('i-1', 'o-1', 'Muzza', 2, 625025, 'sin cebolla')`);
  run(`INSERT INTO order_events (id, order_id, event, actor, detail) VALUES ('e-1', 'o-1', 'assigned', 'admin', 'Repartidor Uno')`);
  run(`INSERT INTO fudo_writes (id, order_id, operation, ok, payload, actor) VALUES ('fw-1', 'o-1', 'create_sale', 1, '{"customerName":"Cliente Uno"}', 'admin:gerente1')`);
  // El cliente: conversación de WhatsApp (teléfono verificado), otra ficha creada por WhatsApp con ese teléfono, y un cliente sin relación.
  run(`INSERT INTO wa_conversations (id, client_phone, client_id, contact_name) VALUES ('w-cli', '5491155550101', 'c-cli', 'Cliente Uno')`);
  run(`INSERT INTO clients (id, name, phone, phone_digits, wa_marketing_opt_in) VALUES ('c-cli-wa', 'Cliente Uno WA', '+5491155550101', '1155550101', 1)`);
  run(`INSERT INTO clients (id, name, phone, phone_digits, wa_marketing_opt_in) VALUES ('c-otro', 'Otro Cliente', '+54 9 11 7777-0303', '1177770303', 1)`);
  run(`UPDATE clients SET wa_marketing_opt_in = 1 WHERE id IN ('c-cli', 'c-ger')`);
  run(`INSERT INTO orders (id, client_id, status, items_desc, total_cents, created_at) VALUES ('o-wa', 'c-cli-wa', 'Finalizados', '1x Flan', 200000, '2026-11-03T20:00:00.000Z')`);
  run(`INSERT INTO points_ledger (id, client_id, order_id, delta, description) VALUES ('l-1', 'c-ger', 'o-2', 100, 'Compra')`);
  run(`INSERT INTO reviews (id, order_id, client_id, rating, feedback) VALUES ('r-1', 'o-2', 'c-ger', 5, 'rico')`);
  run(`INSERT INTO payment_intents (id, client_id, channel, total_cents, snapshot, expires_at) VALUES ('pi-1', 'c-ger', 'web', 300000, '{"address":"Calle 2"}', '2099-01-01T00:00:00.000Z')`);
  run(`INSERT INTO wa_conversations (id, client_phone, client_id, contact_name) VALUES ('w-1', '5491166660202', 'c-ger', 'Gerente Uno')`);
  run(`INSERT INTO wa_messages (id, conversation_id, wamid, direction, type, body) VALUES ('wm-1', 'w-1', 'wamid.1', 'in', 'text', 'Hola')`);
  run(`INSERT INTO reclamos (id, numero, conversation_id, client_phone, client_id, order_id, categoria, motivo) VALUES ('rc-1', 1, 'w-1', '5491166660202', 'c-ger', 'o-2', 'demora', 'tardó')`);
  run(`INSERT INTO reclamos_eventos (id, reclamo_id, tipo, detalle, autor) VALUES ('re-1', 'rc-1', 'creado', 'tardó', 'bot')`);
  for (const [id, userId, email] of [["la-1", "gerente1", "gerente@local.test"], ["la-2", "u-cli", "cliente@example.test"]]) {
    run(`INSERT INTO legal_acceptances (id, user_id, email, role, document, version, ip, user_agent) VALUES (?, ?, ?, 'x', 'terminos', '2026-10-14', '203.0.113.9', 'UA-x')`, id, userId, email);
  }
  run(`INSERT INTO integration_settings (key, value_enc, updated_at, updated_by) VALUES ('ajuste', 'v1:x:y', ?, 'gerente1')`, NOW);
  run(`INSERT INTO kb_errores (id, clave, escenario, tipo, mensaje_cliente, respuesta_mala, motivo, correccion, origen) VALUES ('kbe-1', 'k1', 'esc', 'otro', 'hola', 'no', 'm', 'c', 'conversacion')`);
  run(`INSERT INTO global_config (key, value) VALUES ('resumen_diario', '{"destinatarios":[{"email":"gerente@local.test"}]}')`);
}

/** Acceso del cliente de prueba (u-cli): contraseña (PASSWORD), una sesión y un token de verificación. */
export async function seedClientLogin(world: World, opts: { password?: boolean } = {}): Promise<void> {
  const { raw } = world.db;
  if (opts.password !== false) {
    raw.prepare(`INSERT INTO "account" (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES ('a-u-cli', 'u-cli', 'credential', 'u-cli', ?, ?, ?)`).run(await hashPassword(world, PASSWORD), NOW, NOW);
  }
  raw.prepare(`INSERT INTO "session" (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId) VALUES ('s-u-cli', '2099-01-01', 'tok-u-cli', ?, ?, '203.0.113.7', 'UA', 'u-cli')`).run(NOW, NOW);
  raw.prepare(`INSERT INTO "verification" (id, identifier, value, expiresAt) VALUES ('v-cli', 'cliente@example.test', 'token-cli', '2099-01-01')`).run();
}

/** Contenido de cada tabla, sin las columnas indicadas (`tabla.columna`). Lo único que puede cambiar al eliminar un usuario. */
export function dumpAll(raw: DatabaseSync, omit: readonly string[] = []): Record<string, string> {
  // Sin el índice FTS5 de kb_negocio ni sus tablas auxiliares (algunas son WITHOUT ROWID): es una copia derivada que mantienen los triggers.
  const tables = (raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'kb_negocio_fts%' ORDER BY name`).all() as { name: string }[]).map((t) => t.name);
  return Object.fromEntries(
    tables.map((t) => {
      const cols = (raw.prepare(`SELECT name FROM pragma_table_info('${t}')`).all() as { name: string }[]).map((c) => c.name).filter((c) => !omit.includes(`${t}.${c}`));
      const rows = cols.length ? raw.prepare(`SELECT ${cols.map((c) => `"${c}"`).join(", ")} FROM "${t}" ORDER BY rowid`).all() : [];
      return [t, JSON.stringify(rows)];
    }),
  );
}
