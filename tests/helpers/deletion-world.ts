/**
 * Mundo de prueba de la eliminación de datos: D1 real (node:sqlite) con dos personas sembradas con marcadores únicos
 * en TODAS las columnas del inventario (Marta, cliente con cuenta y WhatsApp; Pedro, repartidor) y personas de control
 * (Beto, un cliente anónimo por canal, otro repartidor) que tienen que quedar intactas.
 *
 * Los marcadores no se parecen a ningún dato de las personas de control: tras la baja, ninguna columna de ninguna tabla
 * puede contener ninguno (ver `leftovers`).
 */
import { createTestDb } from "./sqlite-d1.ts";
import { createAuth } from "../../src/lib/data/auth.ts";

export const BASE = "https://opsyndely.la-gambeta.com";
export const PASSWORD = "clave-segura-123";
export const SUPER_EMAIL = "dueno@local.test";

export const MARTA = {
  userId: "u-marta",
  clientId: "c-marta",
  waClientId: "c-marta-wa",
  conversationId: "w-marta",
  email: "marta.pii@example.test",
  name: "Marta PII Gómez",
  phone: "+54 9 11 5555-0101",
  tail: "1155550101",
  digits: "5491155550101",
  address: "Calle PII 123, CABA",
  photo: "reclamos/r-marta/aaaa-1111.jpg",
} as const;

/** Lo que el dueño confirma cuando la previsualización de Marta por teléfono encuentra su cuenta y sus dos fichas. */
export const MARTA_CONFIRM = { confirmedUserIds: [MARTA.userId], confirmedClientIds: [MARTA.clientId, MARTA.waClientId] } as const;

/** Otra persona con el MISMO teléfono que Marta pero otro email (cargó el dato a mano, por ejemplo): no es Marta. */
export const OTRO = { userId: "u-otro", clientId: "c-otro", email: "otro@example.test", name: "Otro Distinto", address: "Calle Otro 999" } as const;

export const PEDRO = {
  userId: "u-pedro",
  email: "repartidor-pedro1@repartidores.dely.opsyn.app",
  name: "Pedro PII",
} as const;

/** Cada dato que identifica a Marta: ninguno puede sobrevivir a su baja. */
export const MARTA_MARKERS = [
  "Marta PII", "marta.pii@example.test", "5555-0101", "1155550101", "Calle PII", "pii-marta", "pii marta", "203.0.113.77", "UA-pii-marta",
  "-34.60371", "-58.38161", "-34.60372", "-58.38162", "7.7143", "u-marta", "c-marta", "w-marta", "vtoken-pii", "pref-pii", "pay-pii", "checkout-pii",
] as const;

/** Cada dato que identifica a Pedro (repartidor). */
export const PEDRO_MARKERS = ["Pedro PII", "pin-hash-pii-pedro", "pin-enc-pii", "-34.61111", "-58.39222", "9.4321", "u-pedro", "repartidor-pedro1"] as const;

export const MARKERS = [...MARTA_MARKERS, ...PEDRO_MARKERS] as const;

/** Un marcador por (tabla, columna) del inventario que se siembra con datos de Marta o Pedro. */
export const SEEDED: Readonly<Record<string, string | number>> = {
  "user.name": MARTA.name, "user.email": MARTA.email, "user.image": "https://img.example/pii-marta.jpg", "user.phone": MARTA.phone,
  "session.ipAddress": "203.0.113.77", "session.userAgent": "UA-pii-marta", "session.token": "tok-pii-marta",
  "account.accountId": MARTA.userId, "account.accessToken": "at-pii-marta", "account.refreshToken": "rt-pii-marta", "account.idToken": "idt-pii-marta",
  "verification.identifier": MARTA.email, "verification.value": "vtoken-pii-marta",
  "clients.name": MARTA.name, "clients.phone": MARTA.phone, "clients.phone_digits": MARTA.tail, "clients.address": MARTA.address, "clients.email": MARTA.email,
  "points_ledger.description": "Compra de Marta PII",
  "reviews.feedback": "feedback pii marta",
  "payment_intents.snapshot": '{"address":"Calle PII 123, CABA","name":"Marta PII Gómez"}', "payment_intents.checkout_url": "https://mp.example/checkout-pii",
  "payment_intents.mp_preference_id": "pref-pii-marta", "payment_intents.mp_payment_id": "pay-pii-marta",
  "orders.customer_name": MARTA.name, "orders.delivery_address": MARTA.address, "orders.delivery_lat": -34.60371, "orders.delivery_lng": -58.38161,
  "orders.delivered_lat": -34.60372, "orders.delivered_lng": -58.38162, "orders.delivered_accuracy_m": 7.7143, "orders.notes": "tocar timbre pii marta",
  "orders.courier_name": PEDRO.name,
  "order_items.fudo_comment": "sin cebolla pii marta",
  "order_events.detail": PEDRO.name,
  "fudo_writes.payload": '{"customerName":"Marta PII Gómez","delivery":{"address":"Calle PII 123, CABA","phone":"+54 9 11 5555-0101"}}',
  "fudo_writes.actor": "cliente:u-marta",
  "couriers.name": PEDRO.name, "couriers.pin_hash": "pin-hash-pii-pedro", "couriers.pin_encrypted": "pin-enc-pii",
  "courier_locations.courier_name": PEDRO.name, "courier_locations.lat": -34.61111, "courier_locations.lng": -58.39222, "courier_locations.accuracy_m": 9.4321,
  "courier_locations.heading": 91.4321, "courier_locations.speed_mps": 3.4321,
  "courier_shifts.courier_name": PEDRO.name,
  "legal_acceptances.user_id": MARTA.userId, "legal_acceptances.email": MARTA.email, "legal_acceptances.ip": "203.0.113.77", "legal_acceptances.user_agent": "UA-pii-marta",
  "wa_conversations.client_phone": MARTA.digits, "wa_conversations.contact_name": "Marta PII (WhatsApp)", "wa_conversations.state": '{"draft":{"address":"Calle PII 123"}}',
  "wa_messages.body": "Hola soy Marta PII, vivo en Calle PII 123",
  "kb_analisis_conversaciones.conversation_id": MARTA.conversationId,
  "reclamos.client_phone": MARTA.digits, "reclamos.client_id": MARTA.waClientId, "reclamos.conversation_id": MARTA.conversationId,
  "reclamos.motivo": "llegó frío pii marta", "reclamos.foto_keys": `["${MARTA.photo}"]`, "reclamos.notas": "nota pii marta", "reclamos.resolucion": "resolución pii marta",
  "reclamos.mensaje_resolucion": "mensaje pii marta", "reclamos.sugerencia": '{"diagnostico":"pii marta"}', "reclamos.sugerencia_error": "error pii marta",
  "reclamos.notificacion_error": "error de envío pii marta",
  "reclamos_eventos.detalle": "Marta PII dijo que llegó frío",
  "integration_settings.updated_by": MARTA.userId,
};

export function setup(superOwnerEmail: string | null = SUPER_EMAIL) {
  const db = createTestDb();
  const auth = createAuth({ database: db.raw, secret: crypto.randomUUID() + crypto.randomUUID(), baseURL: BASE });
  return { db, auth, opts: { superOwnerEmail }, files: new FakeBucket() };
}
export type World = ReturnType<typeof setup>;

/** Bucket R2 de mentira: guarda qué claves se pidió borrar y puede fallar a pedido. */
export class FakeBucket {
  deleted: string[] = [];
  failWith: Error | null = null;
  async delete(keys: string[]): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.deleted.push(...keys);
  }
}

const NOW = "2026-11-10T15:00:00.000Z";

export async function hashPassword(world: Pick<World, "auth">, password: string): Promise<string> {
  return (await world.auth.$context).password.hash(password);
}

/** Usuarios del personal: el dueño principal, otro dueño, un gerente y un cajero. */
export function seedStaff(world: World) {
  const ins = world.db.raw.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, role, staff_role, banned, createdAt, updatedAt) VALUES (?, ?, ?, 1, 'admin', ?, 0, ?, ?)`,
  );
  ins.run("dueno", "Dueña", SUPER_EMAIL, "admin", NOW, NOW);
  ins.run("socio", "Socio", "socio@local.test", "admin", NOW, NOW);
  ins.run("gerente1", "Gerente", "gerente@local.test", "gerente", NOW, NOW);
  ins.run("cajero1", "Cajero", "cajero@local.test", "cajero", NOW, NOW);
}

/** Marta (cliente con cuenta y conversación de WhatsApp), Pedro (repartidor) y las personas de control. */
export async function seedWorld(world: World): Promise<void> {
  const { raw } = world.db;
  const run = (sql: string, ...params: (string | number | null)[]) => raw.prepare(sql).run(...params);
  const hash = await hashPassword(world, PASSWORD);
  seedStaff(world);

  // --- Marta
  run(`INSERT INTO "user" (id, name, email, emailVerified, image, role, phone, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, 'cliente', ?, ?, ?)`,
    MARTA.userId, MARTA.name, MARTA.email, SEEDED["user.image"] as string, MARTA.phone, NOW, NOW);
  run(`INSERT INTO "session" (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId) VALUES ('s-marta', '2099-01-01', ?, ?, ?, ?, ?, ?)`,
    "tok-pii-marta", NOW, NOW, "203.0.113.77", "UA-pii-marta", MARTA.userId);
  run(`INSERT INTO "account" (id, accountId, providerId, userId, accessToken, refreshToken, idToken, password, createdAt, updatedAt) VALUES ('a-marta', ?, 'credential', ?, ?, ?, ?, ?, ?, ?)`,
    MARTA.userId, MARTA.userId, "at-pii-marta", "rt-pii-marta", "idt-pii-marta", hash, NOW, NOW);
  run(`INSERT INTO "verification" (id, identifier, value, expiresAt) VALUES ('v-1', ?, ?, '2099-01-01')`, MARTA.email, "vtoken-pii-marta");
  run(`INSERT INTO "verification" (id, identifier, value, expiresAt) VALUES ('v-2', 'reset-password:abc123', ?, '2099-01-01')`, MARTA.userId);
  run(`INSERT INTO clients (id, user_id, name, phone, phone_digits, address, email) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    MARTA.clientId, MARTA.userId, MARTA.name, MARTA.phone, MARTA.tail, MARTA.address, MARTA.email);
  run(`INSERT INTO clients (id, name, phone, phone_digits) VALUES (?, 'Marta WA', ?, ?)`, MARTA.waClientId, `+${MARTA.digits}`, MARTA.tail);

  run(`INSERT INTO "user" (id, name, email, emailVerified, role, createdAt, updatedAt) VALUES (?, ?, ?, 1, 'repartidor', ?, ?)`, PEDRO.userId, PEDRO.name, PEDRO.email, NOW, NOW);

  run(`INSERT INTO orders (id, client_id, status, items_desc, total_cents, delivery_fee_cents, payment_method, created_at, delivered_at, channel,
         customer_name, delivery_address, delivery_lat, delivery_lng, delivered_lat, delivered_lng, delivered_accuracy_m, notes, courier_name, courier_user_id)
       VALUES ('o-m1', ?, 'Finalizados', '2x Muzza', 1250050, 30000, 'Mercado Pago', '2026-11-01T20:00:00.000Z', '2026-11-01T20:40:00.000Z', 'web',
         ?, ?, -34.60371, -58.38161, -34.60372, -58.38162, 7.7143, 'tocar timbre pii marta', ?, ?)`,
    MARTA.clientId, MARTA.name, MARTA.address, PEDRO.name, PEDRO.userId);
  run(`INSERT INTO orders (id, client_id, status, items_desc, total_cents, payment_method, created_at, channel, customer_name)
       VALUES ('o-m2', ?, 'Cancelado', '1x Flan', 300000, 'Efectivo', '2026-11-02T20:00:00.000Z', 'whatsapp', ?)`,
    MARTA.waClientId, MARTA.name);
  run(`INSERT INTO order_items (id, order_id, name, qty, unit_price_cents, fudo_comment) VALUES ('i-m1', 'o-m1', 'Muzza', 2, 625025, ?)`, "sin cebolla pii marta");
  run(`INSERT INTO order_events (id, order_id, event, actor, detail) VALUES ('e-m1', 'o-m1', 'Finalizados', 'admin', NULL)`);
  run(`INSERT INTO order_events (id, order_id, event, actor, detail) VALUES ('e-m2', 'o-m1', 'assigned', 'admin', ?)`, PEDRO.name);
  run(`INSERT INTO fudo_writes (id, order_id, operation, ok, payload, actor) VALUES ('fw-1', 'o-m1', 'create_sale', 1, ?, 'system:orders.patch:admin:dueno')`, SEEDED["fudo_writes.payload"] as string);
  run(`INSERT INTO fudo_writes (id, order_id, operation, ok, payload, actor) VALUES ('fw-2', 'o-m1', 'payment', 1, NULL, 'cliente:u-marta')`);
  run(`INSERT INTO points_ledger (id, client_id, order_id, delta, description) VALUES ('l-m1', ?, 'o-m1', 100, 'Compra de Marta PII')`, MARTA.clientId);
  run(`INSERT INTO reviews (id, order_id, client_id, rating, feedback) VALUES ('r-m1', 'o-m1', ?, 5, 'feedback pii marta')`, MARTA.clientId);
  run(`INSERT INTO payment_intents (id, client_id, channel, total_cents, snapshot, checkout_url, mp_preference_id, mp_payment_id, order_id, expires_at, status)
       VALUES ('pi-m1', ?, 'web', 1250050, ?, 'https://mp.example/checkout-pii', 'pref-pii-marta', 'pay-pii-marta', 'o-m1', '2099-01-01T00:00:00.000Z', 'approved')`,
    MARTA.clientId, SEEDED["payment_intents.snapshot"] as string);
  run(`INSERT INTO legal_acceptances (id, user_id, email, role, document, version, ip, user_agent) VALUES ('la-1', ?, ?, 'cliente', 'terminos', '2026-10-14', '203.0.113.77', 'UA-pii-marta')`, MARTA.userId, MARTA.email);
  run(`INSERT INTO legal_acceptances (id, user_id, email, role, document, version, ip, user_agent) VALUES ('la-2', ?, ?, 'cliente', 'privacidad', '2026-10-14', '203.0.113.77', 'UA-pii-marta')`, MARTA.userId, MARTA.email);
  run(`INSERT INTO integration_settings (key, value_enc, updated_at, updated_by) VALUES ('algun_ajuste', 'v1:x:y', ?, ?)`, NOW, MARTA.userId);

  run(`INSERT INTO wa_conversations (id, client_phone, client_id, contact_name, state) VALUES (?, ?, ?, 'Marta PII (WhatsApp)', ?)`,
    MARTA.conversationId, MARTA.digits, MARTA.waClientId, SEEDED["wa_conversations.state"] as string);
  run(`INSERT INTO wa_messages (id, conversation_id, wamid, direction, type, body) VALUES ('wm-1', ?, 'wamid.1', 'in', 'text', ?)`, MARTA.conversationId, SEEDED["wa_messages.body"] as string);
  run(`INSERT INTO wa_messages (id, conversation_id, wamid, direction, type, body) VALUES ('wm-2', ?, 'wamid.2', 'out', 'text', 'Hola, ¿en qué te ayudo?')`, MARTA.conversationId);
  run(`INSERT INTO kb_analisis_conversaciones (conversation_id, dia, resultado) VALUES (?, '2026-11-02', 'ok')`, MARTA.conversationId);
  run(`INSERT INTO reclamos (id, numero, conversation_id, client_phone, client_id, order_id, categoria, motivo, foto_keys, estado, resolucion, compensacion_tipo, compensacion_valor,
         notas, mensaje_resolucion, sugerencia, sugerencia_error, notificacion_error)
       VALUES ('r-marta', 1, ?, ?, ?, 'o-m1', 'llego_frio', ?, ?, 'resuelto', ?, 'puntos', 50, ?, ?, ?, ?, ?)`,
    MARTA.conversationId, MARTA.digits, MARTA.waClientId, "llegó frío pii marta", SEEDED["reclamos.foto_keys"] as string, "resolución pii marta",
    "nota pii marta", "mensaje pii marta", SEEDED["reclamos.sugerencia"] as string, "error pii marta", "error de envío pii marta");
  run(`INSERT INTO reclamos_eventos (id, reclamo_id, tipo, detalle, autor) VALUES ('re-1', 'r-marta', 'creado', 'Marta PII dijo que llegó frío', 'bot')`);

  // --- Pedro, repartidor
  run(`INSERT INTO couriers (user_id, name, pin_hash, pin_encrypted) VALUES (?, ?, 'pin-hash-pii-pedro', 'pin-enc-pii')`, PEDRO.userId, PEDRO.name);
  run(`INSERT INTO courier_locations (user_id, courier_name, lat, lng, accuracy_m, heading, speed_mps) VALUES (?, ?, -34.61111, -58.39222, 9.4321, 91.4321, 3.4321)`, PEDRO.userId, PEDRO.name);
  run(`INSERT INTO courier_shifts (id, user_id, courier_name, shift_day, status) VALUES ('cs-1', ?, ?, '2026-11-02', 'approved')`, PEDRO.userId, PEDRO.name);
  run(`INSERT INTO fudo_writes (id, order_id, operation, ok, payload, actor) VALUES ('fw-3', 'o-m1', 'close_sale', 1, NULL, 'repartidor:u-pedro')`);

  // --- Controles: no tienen que cambiar
  run(`INSERT INTO "user" (id, name, email, emailVerified, role, phone, createdAt, updatedAt) VALUES ('u-beto', 'Beto Ríos', 'beto@example.test', 1, 'cliente', '+54 9 11 6666-0202', ?, ?)`, NOW, NOW);
  run(`INSERT INTO "session" (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId) VALUES ('s-beto', '2099-01-01', 'tok-beto', ?, ?, '198.51.100.9', 'UA-beto', 'u-beto')`, NOW, NOW);
  run(`INSERT INTO "account" (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES ('a-beto', 'u-beto', 'credential', 'u-beto', ?, ?, ?)`, await hashPassword(world, PASSWORD), NOW, NOW);
  run(`INSERT INTO clients (id, user_id, name, phone, phone_digits, address, email) VALUES ('c-beto', 'u-beto', 'Beto Ríos', '+54 9 11 6666-0202', '1166660202', 'Av. Beto 456', 'beto@example.test')`);
  run(`INSERT INTO orders (id, client_id, status, items_desc, total_cents, payment_method, created_at, customer_name, delivery_address, notes)
       VALUES ('o-b1', 'c-beto', 'Finalizados', '1x Milanesa', 700000, 'Tarjeta', '2026-11-03T20:00:00.000Z', 'Beto Ríos', 'Av. Beto 456', 'portero 3B')`);
  run(`INSERT INTO order_items (id, order_id, name, qty, unit_price_cents, fudo_comment) VALUES ('i-b1', 'o-b1', 'Milanesa', 1, 700000, 'sin sal')`);
  run(`INSERT INTO points_ledger (id, client_id, delta, description) VALUES ('l-b1', 'c-beto', 70, 'Compra de Beto')`);
  run(`INSERT INTO reviews (id, order_id, client_id, rating, feedback) VALUES ('r-b1', 'o-b1', 'c-beto', 4, 'rico')`);
  run(`INSERT INTO legal_acceptances (id, user_id, email, role, document, version, ip, user_agent) VALUES ('la-b', 'u-beto', 'beto@example.test', 'cliente', 'terminos', '2026-10-14', '198.51.100.9', 'UA-beto')`);
  run(`INSERT INTO wa_conversations (id, client_phone, client_id, contact_name) VALUES ('w-beto', '5491166660202', 'c-beto', 'Beto')`);
  run(`INSERT INTO wa_messages (id, conversation_id, wamid, direction, type, body) VALUES ('wm-b', 'w-beto', 'wamid.b', 'in', 'text', 'Hola soy Beto')`);
  run(`INSERT INTO reclamos (id, numero, conversation_id, client_phone, client_id, categoria, motivo) VALUES ('r-beto', 2, 'w-beto', '5491166660202', 'c-beto', 'demora', 'tardó mucho')`);
  run(`INSERT INTO reclamos_eventos (id, reclamo_id, tipo, detalle, autor) VALUES ('re-b', 'r-beto', 'creado', 'Beto reclamó', 'bot')`);
  // Cliente anónimo por canal: no es una persona (la prueba "el cliente anónimo..." le pone el teléfono de Marta).
  run(`INSERT INTO clients (id, name, is_anonymous, channel) VALUES ('c-anon', 'PedidosYa', 1, 'pedidosya')`);
  run(`INSERT INTO orders (id, client_id, status, items_desc, total_cents, created_at, customer_name) VALUES ('o-anon', 'c-anon', 'Finalizados', '1x Pizza', 500000, '2026-11-04T20:00:00.000Z', 'PedidosYa')`);
  // Otro repartidor
  run(`INSERT INTO "user" (id, name, email, emailVerified, role, createdAt, updatedAt) VALUES ('u-rep2', 'Rep Dos', 'repartidor-rep2@repartidores.dely.opsyn.app', 1, 'repartidor', ?, ?)`, NOW, NOW);
  run(`INSERT INTO couriers (user_id, name, pin_hash) VALUES ('u-rep2', 'Rep Dos', 'pin-hash-rep2')`);
  run(`INSERT INTO courier_locations (user_id, courier_name, lat, lng) VALUES ('u-rep2', 'Rep Dos', -34.7, -58.4)`);
  run(`INSERT INTO orders (id, client_id, status, items_desc, total_cents, created_at, courier_name, courier_user_id) VALUES ('o-r2', 'c-beto', 'Finalizados', '1x Empanadas', 400000, '2026-11-05T20:00:00.000Z', 'Rep Dos', 'u-rep2')`);
  run(`INSERT INTO order_events (id, order_id, event, actor, detail) VALUES ('e-r2', 'o-r2', 'assigned', 'admin', 'Rep Dos')`);
  run(`INSERT INTO fudo_writes (id, order_id, operation, ok, payload, actor) VALUES ('fw-b', 'o-b1', 'create_sale', 1, '{"customerName":"Beto Ríos"}', 'admin:dueno')`);
  // Aprendizaje del bot (enmascarado, sin vínculo con la persona)
  run(`INSERT INTO kb_errores (id, clave, escenario, tipo, mensaje_cliente, respuesta_mala, motivo, correccion, origen) VALUES ('kbe-1', 'k1', 'esc', 'otro', 'hola, soy [nombre]', 'no entendí', 'm', 'c', 'conversacion')`);
}

/** Cuenta, ficha y pedido de OTRO: comparte el teléfono de Marta pero no su email. Nada de esto puede cambiar al borrar a Marta por email. */
export function seedLookalike(world: Pick<World, "db">): void {
  const run = (sql: string, ...params: (string | number | null)[]) => world.db.raw.prepare(sql).run(...params);
  const now = "2026-11-10T15:00:00.000Z";
  run(`INSERT INTO "user" (id, name, email, emailVerified, role, phone, createdAt, updatedAt) VALUES (?, ?, ?, 1, 'cliente', ?, ?, ?)`, OTRO.userId, OTRO.name, OTRO.email, MARTA.phone, now, now);
  run(`INSERT INTO "session" (id, expiresAt, token, createdAt, updatedAt, userId) VALUES ('s-otro', '2099-01-01', 'tok-otro', ?, ?, ?)`, now, now, OTRO.userId);
  run(`INSERT INTO clients (id, user_id, name, phone, phone_digits, address, email) VALUES (?, ?, ?, ?, ?, ?, ?)`, OTRO.clientId, OTRO.userId, OTRO.name, MARTA.phone, MARTA.tail, OTRO.address, OTRO.email);
  run(`INSERT INTO orders (id, client_id, status, items_desc, total_cents, payment_method, created_at, customer_name, delivery_address, notes)
       VALUES ('o-otro', ?, 'Finalizados', '1x Fugazza', 800000, 'Efectivo', '2026-11-06T20:00:00.000Z', ?, ?, 'timbre otro')`, OTRO.clientId, OTRO.name, OTRO.address);
  run(`INSERT INTO points_ledger (id, client_id, delta, description) VALUES ('l-otro', ?, 80, 'Compra de Otro')`, OTRO.clientId);
}

/** Estado de OTRO: cuenta, sesión, ficha, pedido y puntos. */
export function otroSnapshot(world: Pick<World, "db">): string {
  const q = (sql: string) => JSON.stringify(world.db.raw.prepare(sql).all());
  return [
    q(`SELECT id, name, email, phone FROM "user" WHERE id = 'u-otro'`), q(`SELECT id, userId FROM session WHERE id = 's-otro'`),
    q(`SELECT id, user_id, name, phone, address, email FROM clients WHERE id = 'c-otro'`),
    q(`SELECT id, client_id, customer_name, delivery_address, notes, total_cents FROM orders WHERE id = 'o-otro'`), q(`SELECT id, client_id, delta FROM points_ledger WHERE id = 'l-otro'`),
  ].join("|");
}

/**
 * Columnas de cualquier tabla que contienen alguno de los marcadores. `live_versions` no se mira: sus topics llevan el id de la
 * conversación o del pedido (un UUID en producción, no un dato personal) y acá los ids de prueba son legibles.
 */
export function leftovers(world: Pick<World, "db">, markers: readonly string[] = MARKERS): string[] {
  const { raw } = world.db;
  const tables = (raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'live_versions'`).all() as { name: string }[]).map((t) => t.name);
  const found: string[] = [];
  for (const table of tables) {
    const columns = (raw.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as { name: string }[]).map((c) => c.name);
    for (const column of columns) {
      for (const marker of markers) {
        const hit = raw.prepare(`SELECT count(*) AS n FROM "${table}" WHERE CAST("${column}" AS TEXT) LIKE ?`).get(`%${marker}%`) as { n: number };
        if (hit.n > 0) found.push(`${table}.${column} contiene "${marker}"`);
      }
    }
  }
  return found;
}

/** Cantidad de filas por tabla: sirve para comprobar que lo de los demás no se movió. */
export function rowCounts(world: Pick<World, "db">, tables: readonly string[]): Record<string, number> {
  return Object.fromEntries(
    tables.map((t) => [t, (world.db.raw.prepare(`SELECT count(*) AS n FROM "${t}"`).get() as { n: number }).n]),
  );
}
