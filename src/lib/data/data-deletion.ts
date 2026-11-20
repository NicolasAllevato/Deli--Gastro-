/**
 * Eliminación de datos personales sobre D1 (Better Auth): previsualiza, ejecuta y registra. docs/eliminacion-datos.md.
 *
 * Quién es "el sujeto": un usuario (id), un teléfono (últimos 10 dígitos) o un email. De ahí se resuelven sus filas:
 *   - ámbito "contact" (herramienta del dueño principal, que verifica la identidad por fuera): usuario + clientes + conversaciones
 *     y reclamos que coincidan por id, teléfono o email, y lo que cuelga de ellos.
 *   - ámbito "account" (autoservicio): SOLO lo que está atado a la cuenta (usuario, sus fichas de cliente, las conversaciones y
 *     reclamos vinculados a esas fichas). El teléfono y el email que cargó el usuario no están verificados: si se usaran para
 *     buscar, alguien podría cargar el teléfono de otra persona y borrarle sus conversaciones y pedidos.
 *
 * Qué pasa con cada tabla: DATA_INVENTORY (data-deletion-inventory.ts) y DELETION_STEPS (abajo). Se borra la cuenta, las sesiones,
 * los mensajes, los puntos y las reseñas; se ANONIMIZAN los pedidos (id, fecha, montos, medio de pago y estado quedan), los
 * reclamos y las constancias legales. Todo en un solo `batch` atómico, junto con el cierre del registro. Es idempotente: lo ya
 * borrado no se vuelve a encontrar.
 *
 * Reglas que se resuelven acá, no en la ruta:
 * - Nunca se borra al dueño principal (SUPER_OWNER_EMAIL) ni al último dueño activo. El lote lleva guardas dentro del mismo SQL
 *   (`json('x')` falla si la condición no se cumple y el lote entero se revierte), así que una carrera entre dos pedidos no deja
 *   al sistema sin dueño.
 * - Registro (data_deletion_requests): solo el hash del teléfono o del email, nunca el dato en claro.
 * - Archivos (fotos de reclamos en R2): se borran antes del lote, sin frenarlo si fallan; los que no se pudieron borrar quedan
 *   anotados en `error` y el estado es 'partial'. Un reintento los vuelve a intentar mientras el reclamo conserve las claves
 *   (si el lote ya se aplicó, las claves se vaciaron: la anotación del registro es la única referencia).
 */
import { createHash, randomUUID } from "node:crypto";
import { actorFromRow, isSuperOwnerEmail } from "../auth/owner-rules.ts";
import { normalizeStaffRole } from "../auth/permissions.ts";
import { ForbiddenError, type Actor } from "./actor.ts";
import type { Auth } from "./auth.ts";
import { ERASED } from "./data-deletion-inventory.ts";
import { nowIso, type SqlDatabase, type SqlStatement, type SqlValue } from "./sql.ts";

export { DATA_INVENTORY, ERASED, type InventoryAction, type InventoryEntry } from "./data-deletion-inventory.ts";

export type DeletionChannel = "admin" | "autoservicio" | "email";
export type DeletionScope = "contact" | "account";

/** Bucket de archivos (R2). Solo lo que usa el borrado: `delete` acepta varias claves, como R2Bucket. */
export interface FileStore {
  delete(keys: string[]): Promise<void>;
}

export interface DeletionOptions {
  /** Email del dueño principal (SUPER_OWNER_EMAIL); null = sin configurar. */
  superOwnerEmail: string | null;
  /** Fotos de reclamos. Sin bucket, las fotos no se pueden borrar y el resultado queda 'partial'. */
  files?: FileStore | null;
  now?: () => Date;
}

export interface DeletionSubject {
  userId?: string;
  /** Con o sin prefijos y signos; cuentan los últimos 10 dígitos. */
  phone?: string;
  email?: string;
}

// --- Normalización y hash -----------------------------------------------------------------------

const MIN_PHONE_DIGITS = 8;
const PHONE_TAIL = 10;

/** Últimos 10 dígitos de un teléfono (como `samePhone`); null si tiene menos de 8 dígitos. */
export function phoneTail(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= MIN_PHONE_DIGITS ? digits.slice(-PHONE_TAIL) : null;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  const email = (raw ?? "").trim().toLowerCase();
  return email.includes("@") ? email : null;
}

/** sha256 del dato normalizado con prefijo de tipo. Es lo único del sujeto que llega al registro. */
export function subjectHash(kind: "phone" | "email" | "user", value: string): string {
  return createHash("sha256").update(`${kind}:${value}`).digest("hex");
}

// --- Pasos del borrado ------------------------------------------------------------------------

type StepKind = "client" | "conversation" | "reclamo" | "email" | "user";

export interface DeletionStep {
  /** Clave del conteo (se guarda en data_deletion_requests.counts). */
  key: string;
  kind: StepKind;
  table: string;
  action: "delete" | "anonymize";
  /** Texto para la pantalla del dueño. */
  label: string;
  /** Todos los `?` se enlazan al mismo id (el del sujeto de ese tipo). */
  where: string;
  params: number;
  /** Asignaciones del UPDATE (solo `anonymize`). Valores fijos: nada del usuario entra al texto SQL. */
  sets?: readonly string[];
}

const ORDERS_OF_CLIENT = "order_id IN (SELECT id FROM orders WHERE client_id = ?)";
const COURIER_NAME = "SELECT name FROM couriers WHERE user_id = ?";

/**
 * El orden importa: lo que se ubica a través de orders.client_id (items, auditoría de Fudo) va antes de anonimizar los pedidos, y el
 * usuario se borra al final. El texto SQL son constantes de este archivo; los valores (ids) siempre van por `bind`.
 */
export const DELETION_STEPS: readonly DeletionStep[] = [
  // Por ficha de cliente
  { key: "fudo_writes", kind: "client", table: "fudo_writes", action: "anonymize", label: "Auditoría de ventas a Fudo (payload)", where: `${ORDERS_OF_CLIENT} AND payload IS NOT NULL`, params: 1, sets: ["payload = NULL"] },
  { key: "order_items", kind: "client", table: "order_items", action: "anonymize", label: "Comentarios de las líneas de pedido", where: `${ORDERS_OF_CLIENT} AND fudo_comment IS NOT NULL`, params: 1, sets: ["fudo_comment = NULL"] },
  {
    key: "orders", kind: "client", table: "orders", action: "anonymize", label: "Pedidos (se conservan fecha, montos, medio de pago y estado)", where: "client_id = ?", params: 1,
    sets: [
      "client_id = NULL", `customer_name = '${ERASED}'`, "delivery_address = NULL", "delivery_lat = NULL", "delivery_lng = NULL",
      "delivered_lat = NULL", "delivered_lng = NULL", "delivered_accuracy_m = NULL", "notes = NULL",
    ],
  },
  { key: "reviews", kind: "client", table: "reviews", action: "delete", label: "Reseñas", where: "client_id = ?", params: 1 },
  { key: "points_ledger", kind: "client", table: "points_ledger", action: "delete", label: "Movimientos de puntos", where: "client_id = ?", params: 1 },
  { key: "payment_intents", kind: "client", table: "payment_intents", action: "delete", label: "Intenciones de pago", where: "client_id = ?", params: 1 },
  { key: "clients", kind: "client", table: "clients", action: "delete", label: "Fichas de cliente", where: "id = ? AND is_anonymous = 0", params: 1 },

  // Por conversación de WhatsApp
  { key: "wa_messages", kind: "conversation", table: "wa_messages", action: "delete", label: "Mensajes de WhatsApp (incluye audios transcriptos)", where: "conversation_id = ?", params: 1 },
  { key: "kb_analisis_conversaciones", kind: "conversation", table: "kb_analisis_conversaciones", action: "delete", label: "Marcas de análisis del bot", where: "conversation_id = ?", params: 1 },
  { key: "wa_conversations", kind: "conversation", table: "wa_conversations", action: "delete", label: "Conversaciones de WhatsApp", where: "id = ?", params: 1 },

  // Por reclamo
  { key: "reclamos_eventos", kind: "reclamo", table: "reclamos_eventos", action: "anonymize", label: "Historial de reclamos (textos)", where: `reclamo_id = ? AND detalle <> '${ERASED}'`, params: 1, sets: [`detalle = '${ERASED}'`] },
  {
    key: "reclamos", kind: "reclamo", table: "reclamos", action: "anonymize", label: "Reclamos (se conservan número, categoría, estado y compensación)", where: "id = ?", params: 1,
    sets: [
      `client_phone = '${ERASED}'`, "client_id = NULL", "conversation_id = 'eliminada-' || id", `motivo = '${ERASED}'`, "foto_keys = '[]'",
      "notas = NULL", "resolucion = NULL", "mensaje_resolucion = NULL", "sugerencia = NULL", "sugerencia_error = NULL", "notificacion_error = NULL",
    ],
  },

  // Por email
  { key: "verification_email", kind: "email", table: "verification", action: "delete", label: "Tokens de verificación (por email)", where: "lower(identifier) = ?", params: 1 },

  // Por usuario (el usuario se borra al final)
  {
    key: "order_events_courier", kind: "user", table: "order_events", action: "anonymize", label: "Bitácora de pedidos (nombre del repartidor)",
    where: `event = 'assigned' AND detail <> '${ERASED}' AND detail IN (${COURIER_NAME})`, params: 1, sets: [`detail = '${ERASED}'`],
  },
  {
    key: "orders_courier", kind: "user", table: "orders", action: "anonymize", label: "Pedidos entregados como repartidor (nombre del repartidor)",
    where: `courier_user_id = ? OR courier_name IN (${COURIER_NAME})`, params: 2, sets: ["courier_user_id = NULL", `courier_name = '${ERASED}'`],
  },
  { key: "courier_locations", kind: "user", table: "courier_locations", action: "delete", label: "Ubicación de repartidor", where: "user_id = ?", params: 1 },
  { key: "courier_shifts", kind: "user", table: "courier_shifts", action: "delete", label: "Habilitaciones de repartidor", where: "user_id = ?", params: 1 },
  { key: "couriers", kind: "user", table: "couriers", action: "delete", label: "Fichas de repartidor", where: "user_id = ?", params: 1 },
  {
    key: "fudo_writes_actor", kind: "user", table: "fudo_writes", action: "anonymize", label: "Auditoría de Fudo (usuario que la originó)",
    where: "substr(actor, -(length(?) + 1)) = ':' || ? AND actor <> 'eliminado'", params: 2, sets: ["actor = 'eliminado'"],
  },
  { key: "integration_settings", kind: "user", table: "integration_settings", action: "anonymize", label: "Ajustes del local (quién los cambió)", where: "updated_by = ?", params: 1, sets: ["updated_by = NULL"] },
  {
    key: "legal_acceptances", kind: "user", table: "legal_acceptances", action: "anonymize", label: "Constancias legales (se conserva la versión y la fecha)", where: "user_id = ?", params: 1,
    sets: ["user_id = NULL", "email = NULL", "ip = NULL", "user_agent = NULL"],
  },
  { key: "session", kind: "user", table: "session", action: "delete", label: "Sesiones", where: "userId = ?", params: 1 },
  { key: "account", kind: "user", table: "account", action: "delete", label: "Credenciales de la cuenta", where: "userId = ?", params: 1 },
  { key: "verification_user", kind: "user", table: "verification", action: "delete", label: "Tokens de recuperación (por usuario)", where: "value = ?", params: 1 },
  { key: "user", kind: "user", table: "user", action: "delete", label: "Cuenta de usuario", where: "id = ?", params: 1 },
];

/** Pedidos que todavía no se entregaron ni se cancelaron: borrar la dirección a mitad de la entrega la rompería. */
const IN_PROGRESS_STATUSES = "('Recibidos', 'En Preparación', 'En Camino')";
const IN_PROGRESS_SQL = `SELECT COUNT(*) AS n FROM orders WHERE client_id = ? AND status IN ${IN_PROGRESS_STATUSES}`;

// --- Resolución del sujeto ----------------------------------------------------------------------

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  staff_role: string | null;
  banned: number | boolean | null;
  phone: string | null;
}

interface Resolved {
  users: UserRow[];
  clientIds: string[];
  conversationIds: string[];
  reclamoIds: string[];
  emails: string[];
  photoKeys: string[];
  /** Pedidos en curso de las fichas de cliente resueltas. */
  inProgressOrders: number;
}

const COLS = `id, email, name, role, staff_role, banned, phone`;
const USERS_BY_ID = `SELECT ${COLS} FROM "user" WHERE id = ?`;
const USERS_BY_EMAIL = `SELECT ${COLS} FROM "user" WHERE email = ?`;
const NORMALIZED_PHONE = `replace(replace(replace(replace(replace(replace(phone, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')`;
const USERS_BY_PHONE = `SELECT ${COLS} FROM "user" WHERE phone IS NOT NULL AND substr(${NORMALIZED_PHONE}, -10) = ?`;
const CLIENT_COLS = `id, phone, email, user_id`;
const CLIENTS_BY_USER = `SELECT ${CLIENT_COLS} FROM clients WHERE user_id = ? AND is_anonymous = 0`;
const CLIENTS_BY_PHONE = `SELECT ${CLIENT_COLS} FROM clients WHERE is_anonymous = 0 AND (phone_digits = ? OR substr(${NORMALIZED_PHONE}, -10) = ?)`;
const CLIENTS_BY_EMAIL = `SELECT ${CLIENT_COLS} FROM clients WHERE is_anonymous = 0 AND lower(email) = ?`;
const CONVERSATIONS_BY_TAIL = `SELECT id FROM wa_conversations WHERE substr(client_phone, -10) = ?`;
const CONVERSATIONS_BY_CLIENT = `SELECT id FROM wa_conversations WHERE client_id = ?`;
const RECLAMOS_BY_TAIL = `SELECT id, foto_keys FROM reclamos WHERE substr(client_phone, -10) = ?`;
const RECLAMOS_BY_CLIENT = `SELECT id, foto_keys FROM reclamos WHERE client_id = ?`;
const RECLAMOS_BY_CONVERSATION = `SELECT id, foto_keys FROM reclamos WHERE conversation_id = ?`;

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

async function rowsOf<T>(db: SqlDatabase, sql: string, ...params: SqlValue[]): Promise<T[]> {
  return (await db.prepare(sql).bind(...params).all<T>()).results;
}

function parseKeys(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(value) ? value.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

interface ClientRow {
  id: string;
  phone: string | null;
  email: string | null;
  user_id: string | null;
}

/** Lo que se sabe de la persona: cuentas, fichas, y los teléfonos y emails con los que se la reconoce. */
interface Identity {
  users: Map<string, UserRow>;
  clients: Map<string, ClientRow>;
  tails: Set<string>;
  emails: Set<string>;
}

/** Rondas de seguimiento por teléfono/email: usuario → ficha → otro teléfono → otra ficha... Acotado a propósito. */
const MAX_ROUNDS = 4;
/** Tope de fichas por pedido: un teléfono compartido (el del local, por ejemplo) no puede arrastrar a decenas de clientes. */
export const MAX_MATCHED_CLIENTS = 10;

const addUsers = (id: Identity, rows: readonly UserRow[]) => rows.forEach((u) => id.users.set(u.id, u));
const addClients = (id: Identity, rows: readonly ClientRow[]) => rows.forEach((c) => id.clients.set(c.id, c));

/**
 * Quién es el sujeto. Ámbito "account": su usuario y sus fichas (user_id), nada más. Ámbito "contact": además se sigue el rastro por
 * teléfono y email (tablas user y clients) hasta MAX_ROUNDS rondas; los clientes anónimos por canal (PedidosYa, etc.) nunca entran.
 */
async function resolveIdentity(db: SqlDatabase, subject: DeletionSubject, scope: DeletionScope): Promise<Identity> {
  const id: Identity = { users: new Map(), clients: new Map(), tails: new Set(), emails: new Set() };
  const userId = subject.userId?.trim();
  if (userId) addUsers(id, await rowsOf<UserRow>(db, USERS_BY_ID, userId));

  if (scope === "account") {
    for (const u of [...id.users.values()]) {
      addClients(id, await rowsOf<ClientRow>(db, CLIENTS_BY_USER, u.id));
      const e = normalizeEmail(u.email);
      if (e) id.emails.add(e);
    }
    return id;
  }

  const email = normalizeEmail(subject.email);
  const tail = phoneTail(subject.phone);
  if (email) id.emails.add(email);
  if (tail) id.tails.add(tail);
  const seenEmails = new Set<string>();
  const seenTails = new Set<string>();
  const seenUsers = new Set<string>();
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const before = id.users.size + id.clients.size + id.tails.size + id.emails.size;
    for (const e of [...id.emails].filter((x) => !seenEmails.has(x))) {
      seenEmails.add(e);
      addUsers(id, await rowsOf<UserRow>(db, USERS_BY_EMAIL, e));
      addClients(id, await rowsOf<ClientRow>(db, CLIENTS_BY_EMAIL, e));
    }
    for (const t of [...id.tails].filter((x) => !seenTails.has(x))) {
      seenTails.add(t);
      addUsers(id, await rowsOf<UserRow>(db, USERS_BY_PHONE, t));
      addClients(id, await rowsOf<ClientRow>(db, CLIENTS_BY_PHONE, t, t));
    }
    for (const u of [...id.users.values()].filter((x) => !seenUsers.has(x.id))) {
      seenUsers.add(u.id);
      addClients(id, await rowsOf<ClientRow>(db, CLIENTS_BY_USER, u.id));
      const t = phoneTail(u.phone);
      if (t) id.tails.add(t);
      const e = normalizeEmail(u.email);
      if (e) id.emails.add(e);
    }
    for (const c of [...id.clients.values()]) {
      const t = phoneTail(c.phone);
      if (t) id.tails.add(t);
      const e = normalizeEmail(c.email);
      if (e) id.emails.add(e);
      if (c.user_id && !id.users.has(c.user_id)) addUsers(id, await rowsOf<UserRow>(db, USERS_BY_ID, c.user_id));
    }
    if (id.users.size + id.clients.size + id.tails.size + id.emails.size === before) break;
  }
  return id;
}

async function resolveSubject(db: SqlDatabase, subject: DeletionSubject, scope: DeletionScope): Promise<Resolved> {
  const identity = await resolveIdentity(db, subject, scope);
  const clientIds = [...identity.clients.keys()];

  const conversationIds: string[] = [];
  for (const t of identity.tails) conversationIds.push(...(await rowsOf<{ id: string }>(db, CONVERSATIONS_BY_TAIL, t)).map((r) => r.id));
  for (const id of clientIds) conversationIds.push(...(await rowsOf<{ id: string }>(db, CONVERSATIONS_BY_CLIENT, id)).map((r) => r.id));
  const conversations = unique(conversationIds);

  const reclamos = new Map<string, string[]>();
  const collect = (rows: { id: string; foto_keys: string | null }[]) => rows.forEach((r) => reclamos.set(r.id, parseKeys(r.foto_keys)));
  for (const t of identity.tails) collect(await rowsOf(db, RECLAMOS_BY_TAIL, t));
  for (const id of clientIds) collect(await rowsOf(db, RECLAMOS_BY_CLIENT, id));
  for (const id of conversations) collect(await rowsOf(db, RECLAMOS_BY_CONVERSATION, id));

  let inProgressOrders = 0;
  for (const id of clientIds) inProgressOrders += Number((await db.prepare(IN_PROGRESS_SQL).bind(id).first<{ n: number }>())?.n ?? 0);

  return {
    users: [...identity.users.values()],
    clientIds,
    conversationIds: conversations,
    reclamoIds: [...reclamos.keys()],
    emails: [...identity.emails],
    photoKeys: unique([...reclamos.values()].flat()),
    inProgressOrders,
  };
}

const idsFor = (kind: StepKind, r: Resolved): string[] => {
  switch (kind) {
    case "client": return r.clientIds;
    case "conversation": return r.conversationIds;
    case "reclamo": return r.reclamoIds;
    case "email": return r.emails;
    case "user": return r.users.map((u) => u.id);
  }
};

const bindId = (id: string, params: number): SqlValue[] => Array.from({ length: params }, () => id);

// --- Previsualización -----------------------------------------------------------------------------

export interface DeletionCountRow {
  key: string;
  table: string;
  action: "delete" | "anonymize";
  label: string;
  count: number;
}

export interface DeletionBlock {
  status: 403 | 409;
  reason: string;
}

export interface DeletionPreview {
  /** Hay algo para eliminar (cuenta, cliente, conversación o reclamo). */
  found: boolean;
  total: number;
  /** Solo los pasos con filas; nunca incluye datos de la persona. */
  rows: DeletionCountRow[];
  /** Fotos de reclamos en R2. */
  files: number;
  /** Tipos de cuenta encontrados (rol), sin nombre ni email. */
  accounts: Array<{ role: string; staffRole: string | null }>;
  warnings: string[];
  blocked: DeletionBlock | null;
}

async function countStep(db: SqlDatabase, step: DeletionStep, id: string): Promise<number> {
  const { table, where } = step;
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).bind(...bindId(id, step.params)).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

async function countAll(db: SqlDatabase, resolved: Resolved): Promise<DeletionCountRow[]> {
  const rows: DeletionCountRow[] = [];
  for (const step of DELETION_STEPS) {
    let count = 0;
    for (const id of idsFor(step.kind, resolved)) count += await countStep(db, step, id);
    if (count > 0) rows.push({ key: step.key, table: step.table, action: step.action, label: step.label, count });
  }
  return rows;
}

const isActiveOwner = (u: UserRow): boolean =>
  u.role === "admin" && !(u.banned === 1 || u.banned === true) && normalizeStaffRole(u.staff_role) === "admin";

const ANOTHER_ACTIVE_OWNER = `SELECT 1 AS ok FROM "user" o WHERE o.id <> ? AND o.role = 'admin' AND COALESCE(o.staff_role, 'admin') = 'admin' AND o.banned = 0 LIMIT 1`;

// `json('x')` falla ("malformed JSON") y revierte el lote entero cuando la condición no se cumple.
const OWNER_REMAINS_GUARD = `SELECT json(CASE WHEN EXISTS (${ANOTHER_ACTIVE_OWNER}) THEN '1' ELSE 'x' END)`;
const SUPER_OWNER_GUARD = `SELECT json(CASE WHEN lower((SELECT email FROM "user" WHERE id = ?)) = ? THEN 'x' ELSE '1' END)`;

export const MESSAGES = {
  superOwner: "Es el dueño principal: no se puede eliminar.",
  lastOwner: "Es el último dueño activo: no se puede eliminar. Antes tiene que haber otro dueño activo.",
  manyOwners: "Los datos coinciden con más de un dueño: no se pueden eliminar desde acá.",
  inProgress: "Hay pedidos en curso (recibidos, en preparación o en camino). Conviene esperar a que se entreguen o cancelarlos antes de borrar la dirección.",
  tooMany: (n: number) => `Coincide con ${n} fichas de cliente (el máximo por pedido es ${MAX_MATCHED_CLIENTS}): revisá el dato; puede ser un teléfono compartido.`,
} as const;

/** ¿Algo impide eliminar a estos usuarios? Dueño principal y último dueño activo. */
async function protectionFor(
  db: SqlDatabase, users: readonly UserRow[], opts: DeletionOptions, clientCount = 0,
): Promise<DeletionBlock | null> {
  if (clientCount > MAX_MATCHED_CLIENTS) return { status: 409, reason: MESSAGES.tooMany(clientCount) };
  if (users.some((u) => isSuperOwnerEmail(u.email, opts.superOwnerEmail))) return { status: 403, reason: MESSAGES.superOwner };
  const owners = users.filter(isActiveOwner);
  if (owners.length > 1) return { status: 409, reason: MESSAGES.manyOwners };
  if (owners.length === 1) {
    const another = await db.prepare(ANOTHER_ACTIVE_OWNER).bind(owners[0].id).first();
    if (!another) return { status: 409, reason: MESSAGES.lastOwner };
  }
  return null;
}

function previewFrom(resolved: Resolved, rows: DeletionCountRow[], blocked: DeletionBlock | null): DeletionPreview {
  const found = resolved.users.length + resolved.clientIds.length + resolved.conversationIds.length + resolved.reclamoIds.length > 0;
  return {
    found,
    total: rows.reduce((sum, r) => sum + r.count, 0),
    rows,
    files: resolved.photoKeys.length,
    accounts: resolved.users.map((u) => ({ role: u.role, staffRole: u.role === "admin" ? normalizeStaffRole(u.staff_role) : null })),
    warnings: resolved.inProgressOrders > 0 ? [MESSAGES.inProgress] : [],
    blocked,
  };
}

const ONLY_SUPER_OWNER = "Solo el dueño principal puede eliminar datos personales.";

/** El único que usa estas funciones desde la herramienta del panel es el dueño principal; se verifica contra la base. */
async function requireSuperOwner(db: SqlDatabase, actor: Actor, opts: DeletionOptions): Promise<string> {
  if (actor.kind !== "admin") throw new ForbiddenError(ONLY_SUPER_OWNER);
  const row = await db.prepare(USERS_BY_ID).bind(actor.userId).first<UserRow>();
  if (!row || row.role !== "admin") throw new ForbiddenError(ONLY_SUPER_OWNER);
  const rules = actorFromRow({ id: row.id, email: row.email, staffRole: row.staff_role, banned: row.banned === 1 || row.banned === true }, opts.superOwnerEmail);
  if (!rules.isSuper) throw new ForbiddenError(ONLY_SUPER_OWNER);
  return row.id;
}

export type DeletionFailure = { ok: false; status: 400 | 403 | 404 | 409 | 429 | 500; error: string };
export type DeletionOutcome<T> = { ok: true; value: T } | DeletionFailure;
const fail = (status: DeletionFailure["status"], error: string): DeletionFailure => ({ ok: false, status, error });

function hasIdentifier(subject: DeletionSubject): boolean {
  return Boolean(subject.userId?.trim() || normalizeEmail(subject.email) || phoneTail(subject.phone));
}

/** Cuántos registros hay por tabla para ese teléfono, email o usuario. Solo el dueño principal. */
export async function previewDeletion(
  db: SqlDatabase, actor: Actor, subject: DeletionSubject, opts: DeletionOptions,
): Promise<DeletionOutcome<DeletionPreview>> {
  await requireSuperOwner(db, actor, opts);
  if (!hasIdentifier(subject)) return fail(400, "Indicá un teléfono (con al menos 8 dígitos) o un email válido.");
  const resolved = await resolveSubject(db, subject, "contact");
  const rows = await countAll(db, resolved);
  return { ok: true, value: previewFrom(resolved, rows, await protectionFor(db, resolved.users, opts, resolved.clientIds.length)) };
}

// --- Ejecución --------------------------------------------------------------------------------------

export interface DeletionResult {
  requestId: string;
  found: boolean;
  status: "completed" | "partial";
  /** Filas borradas o anonimizadas por paso, más `archivos_r2`. */
  counts: Record<string, number>;
  total: number;
  files: { total: number; failed: number };
}

const SAFE_PHOTO_KEY = /^reclamos\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/;
const R2_CHUNK = 500;
const MAX_ERROR = 1900;

/** Borra los archivos sin frenar el resto: devuelve las claves que no se pudieron borrar. */
async function removeFiles(files: FileStore | null | undefined, keys: readonly string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  const safe = keys.filter((k) => SAFE_PHOTO_KEY.test(k));
  const failed = keys.filter((k) => !SAFE_PHOTO_KEY.test(k));
  if (!files) return [...failed, ...safe];
  for (let i = 0; i < safe.length; i += R2_CHUNK) {
    const chunk = safe.slice(i, i + R2_CHUNK);
    try {
      await files.delete(chunk);
    } catch (e: unknown) {
      console.error("[eliminar-datos] no se pudieron borrar archivos de R2", chunk.length, e instanceof Error ? e.message : "error");
      failed.push(...chunk);
    }
  }
  return failed;
}

function primaryHash(subject: DeletionSubject, resolved: Resolved): string {
  const tail = phoneTail(subject.phone);
  if (tail) return subjectHash("phone", tail);
  const email = normalizeEmail(subject.email) ?? normalizeEmail(resolved.users[0]?.email);
  return email ? subjectHash("email", email) : subjectHash("user", subject.userId?.trim() || "desconocido");
}

/** Guardas del lote: si la condición no se cumple, `json('x')` falla y se revierte todo (sin dueño no se queda el sistema). */
function guardStatements(db: SqlDatabase, users: readonly UserRow[], opts: DeletionOptions): SqlStatement[] {
  const out: SqlStatement[] = [];
  for (const u of users) {
    if (opts.superOwnerEmail) out.push(db.prepare(SUPER_OWNER_GUARD).bind(u.id, opts.superOwnerEmail.trim().toLowerCase()));
    if (isActiveOwner(u)) out.push(db.prepare(OWNER_REMAINS_GUARD).bind(u.id));
  }
  return out;
}

function stepStatements(db: SqlDatabase, resolved: Resolved): SqlStatement[] {
  const out: SqlStatement[] = [];
  for (const step of DELETION_STEPS) {
    const { table, where } = step;
    for (const id of idsFor(step.kind, resolved)) {
      if (step.action === "delete") {
        out.push(db.prepare(`DELETE FROM ${table} WHERE ${where}`).bind(...bindId(id, step.params)));
      } else {
        const sets = step.sets ?? [];
        out.push(db.prepare(`UPDATE ${table} SET ${sets.join(", ")} WHERE ${where}`).bind(...bindId(id, step.params)));
      }
    }
  }
  return out;
}

interface RunInput {
  subject: DeletionSubject;
  scope: DeletionScope;
  channel: DeletionChannel;
  performedBy: string | null;
}

/** Corre el borrado ya autorizado: registra, borra archivos, aplica el lote atómico y cierra el registro. */
async function runDeletion(db: SqlDatabase, input: RunInput, opts: DeletionOptions): Promise<DeletionOutcome<DeletionResult>> {
  const resolved = await resolveSubject(db, input.subject, input.scope);
  const blocked = await protectionFor(db, resolved.users, opts, resolved.clientIds.length);
  if (blocked) return fail(blocked.status, blocked.reason);

  const rows = await countAll(db, resolved);
  const counts: Record<string, number> = Object.fromEntries(rows.map((r) => [r.key, r.count]));
  const requestId = randomUUID();
  const requestedAt = (opts.now?.() ?? new Date()).toISOString();
  await db
    .prepare(`INSERT INTO data_deletion_requests (id, subject_hash, channel, requested_at, performed_by, status) VALUES (?, ?, ?, ?, ?, 'pending')`)
    .bind(requestId, primaryHash(input.subject, resolved), input.channel, requestedAt, input.performedBy)
    .run();

  const failedKeys = await removeFiles(opts.files, resolved.photoKeys);
  if (resolved.photoKeys.length > 0) counts.archivos_r2 = resolved.photoKeys.length - failedKeys.length;
  const status = failedKeys.length > 0 ? "partial" : "completed";
  const note = failedKeys.length > 0
    ? `No se pudieron borrar ${failedKeys.length} archivo(s) de R2 (bucket de fotos de reclamos): ${failedKeys.join(", ")}`.slice(0, MAX_ERROR)
    : null;

  try {
    await db.batch([
      ...guardStatements(db, resolved.users, opts),
      ...stepStatements(db, resolved),
      db
        .prepare(`UPDATE data_deletion_requests SET status = ?, completed_at = ?, counts = ?, error = ? WHERE id = ?`)
        .bind(status, (opts.now?.() ?? new Date()).toISOString(), JSON.stringify(counts), note, requestId),
    ]);
  } catch (e: unknown) {
    console.error("[eliminar-datos] el lote falló y se revirtió", e instanceof Error ? e.message : "error");
    await db
      .prepare(`UPDATE data_deletion_requests SET status = 'failed', completed_at = ?, error = ? WHERE id = ?`)
      .bind(nowIso(), "No se aplicó ningún cambio: el lote se revirtió.", requestId)
      .run()
      .catch(() => undefined);
    // Una guarda que saltó entre la verificación y el lote (carrera): se informa igual que la verificación previa.
    const latest = await resolveSubject(db, input.subject, input.scope);
    const again = await protectionFor(db, latest.users, opts, latest.clientIds.length);
    return again ? fail(again.status, again.reason) : fail(500, "No se pudo eliminar. No se cambió ningún dato; probá de nuevo.");
  }

  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const found = resolved.users.length + resolved.clientIds.length + resolved.conversationIds.length + resolved.reclamoIds.length > 0;
  return {
    ok: true,
    value: { requestId, found, status, counts, total, files: { total: resolved.photoKeys.length, failed: failedKeys.length } },
  };
}

/** Eliminación pedida desde la herramienta del panel por teléfono o email. Solo el dueño principal. */
export async function deleteSubjectData(
  db: SqlDatabase, actor: Actor, input: { phone?: string; email?: string; channel: Extract<DeletionChannel, "admin" | "email"> }, opts: DeletionOptions,
): Promise<DeletionOutcome<DeletionResult>> {
  const performer = await requireSuperOwner(db, actor, opts);
  const subject: DeletionSubject = { phone: input.phone, email: input.email };
  if (!hasIdentifier(subject)) return fail(400, "Indicá un teléfono (con al menos 8 dígitos) o un email válido.");
  return runDeletion(db, { subject, scope: "contact", channel: input.channel, performedBy: performer }, opts);
}

/** Registro reciente de pedidos de eliminación: sin datos personales (ni el hash ni quién lo hizo). */
export interface DeletionRequestView {
  id: string;
  channel: DeletionChannel;
  status: "pending" | "completed" | "partial" | "failed";
  requestedAt: string;
  completedAt: string | null;
  counts: Record<string, number>;
  total: number;
  error: string | null;
}

interface RequestRow {
  id: string;
  channel: DeletionChannel;
  status: DeletionRequestView["status"];
  requested_at: string;
  completed_at: string | null;
  counts: string;
  error: string | null;
}

const RECENT_LIMIT = 30;

export async function listDeletionRequests(db: SqlDatabase, actor: Actor, opts: DeletionOptions): Promise<DeletionRequestView[]> {
  await requireSuperOwner(db, actor, opts);
  const rows = await rowsOf<RequestRow>(
    db,
    `SELECT id, channel, status, requested_at, completed_at, counts, error FROM data_deletion_requests ORDER BY requested_at DESC LIMIT ?`,
    RECENT_LIMIT,
  );
  return rows.map((r) => {
    let counts: Record<string, number> = {};
    try {
      const parsed: unknown = JSON.parse(r.counts);
      if (parsed && typeof parsed === "object") counts = parsed as Record<string, number>;
    } catch {
      counts = {};
    }
    const total = Object.entries(counts).filter(([k]) => k !== "archivos_r2").reduce((sum, [, n]) => sum + Number(n || 0), 0);
    return { id: r.id, channel: r.channel, status: r.status, requestedAt: r.requested_at, completedAt: r.completed_at, counts, total, error: r.error };
  });
}

// --- Autoservicio ---------------------------------------------------------------------------------

export const SELF_MESSAGES = {
  courier: "Los repartidores no pueden eliminar su cuenta desde acá. Pedíselo al local.",
  superOwner: "Sos el dueño principal: tu cuenta no se puede eliminar desde la aplicación. Para darla de baja hay que cambiar antes el dueño principal en la configuración del sistema.",
  lastOwner: "Sos el único dueño activo: no podés eliminar tu cuenta. Antes creá o activá a otro dueño.",
  inProgress: "Tenés un pedido en curso. Cuando se entregue o se cancele vas a poder eliminar tu cuenta.",
  notFound: "No encontramos tu cuenta.",
  wrongPassword: "La contraseña no es correcta.",
  noPassword: "Tu cuenta no tiene contraseña: pedí la eliminación por email.",
  locked: "Demasiados intentos con contraseña incorrecta. Probá de nuevo en un rato.",
} as const;

export type Eligibility = { canDelete: true } | { canDelete: false; status: 403 | 404 | 409; reason: string };

async function findUser(db: SqlDatabase, userId: string): Promise<UserRow | null> {
  return db.prepare(USERS_BY_ID).bind(userId).first<UserRow>();
}

/** ¿Puede esta persona eliminar su propia cuenta? Repartidores, dueño principal, último dueño y pedidos en curso, no. */
export async function ownAccountEligibility(db: SqlDatabase, userId: string, opts: DeletionOptions): Promise<Eligibility> {
  const user = await findUser(db, userId);
  if (!user) return { canDelete: false, status: 404, reason: SELF_MESSAGES.notFound };
  if (user.role === "repartidor") return { canDelete: false, status: 403, reason: SELF_MESSAGES.courier };
  if (user.role !== "cliente" && user.role !== "admin") return { canDelete: false, status: 403, reason: SELF_MESSAGES.notFound };
  if (isSuperOwnerEmail(user.email, opts.superOwnerEmail)) return { canDelete: false, status: 403, reason: SELF_MESSAGES.superOwner };
  const block = await protectionFor(db, [user], { ...opts, superOwnerEmail: null });
  if (block) return { canDelete: false, status: 409, reason: SELF_MESSAGES.lastOwner };
  const resolved = await resolveSubject(db, { userId }, "account");
  if (resolved.inProgressOrders > 0) return { canDelete: false, status: 409, reason: SELF_MESSAGES.inProgress };
  return { canDelete: true };
}

// Bloqueo de intentos de contraseña: reutiliza courier_pin_attempts con una clave propia (no toca el tope global del PIN).
const PASSWORD_MAX_FAILURES = 5;
const PASSWORD_WINDOW_MS = 15 * 60_000;
const PASSWORD_LOCK_MS = 30 * 60_000;
const lockKey = (userId: string) => `delete-account:${userId}`;

async function isLocked(db: SqlDatabase, userId: string, now: Date): Promise<boolean> {
  const row = await db.prepare(`SELECT locked_until FROM courier_pin_attempts WHERE key = ?`).bind(lockKey(userId)).first<{ locked_until: string | null }>();
  return !!row?.locked_until && row.locked_until > now.toISOString();
}

async function recordFailure(db: SqlDatabase, userId: string, now: Date): Promise<void> {
  const nowStr = now.toISOString();
  const windowStart = new Date(now.getTime() - PASSWORD_WINDOW_MS).toISOString();
  const lockUntil = new Date(now.getTime() + PASSWORD_LOCK_MS).toISOString();
  await db
    .prepare(
      `INSERT INTO courier_pin_attempts (key, failures, window_start) VALUES (?, 1, ?)
       ON CONFLICT (key) DO UPDATE SET
         failures     = CASE WHEN window_start < ? THEN 1 ELSE failures + 1 END,
         window_start = CASE WHEN window_start < ? THEN ? ELSE window_start END,
         locked_until = CASE WHEN (CASE WHEN window_start < ? THEN 1 ELSE failures + 1 END) >= ? THEN ? ELSE locked_until END`,
    )
    .bind(lockKey(userId), nowStr, windowStart, windowStart, nowStr, windowStart, PASSWORD_MAX_FAILURES, lockUntil)
    .run();
}

/** ¿La contraseña es la de la cuenta de contraseña? Usa el verificador de la config real de Better Auth. */
async function passwordMatches(db: SqlDatabase, auth: Auth, userId: string, candidate: string): Promise<boolean> {
  const account = await db
    .prepare(`SELECT password FROM "account" WHERE userId = ? AND providerId = 'credential'`)
    .bind(userId)
    .first<{ password: string | null }>();
  if (!account?.password) return false;
  return (await auth.$context).password.verify({ hash: account.password, password: candidate });
}

/**
 * Eliminación de la propia cuenta (cliente o personal del local): pide la contraseña actual y borra de inmediato.
 * El usuario sale de la sesión del servidor, nunca de un dato que mande el pedido. Los permisos de sesión se cierran junto con la cuenta.
 */
export async function deleteOwnAccount(
  db: SqlDatabase, auth: Auth, input: { userId: string; password: string }, opts: DeletionOptions,
): Promise<DeletionOutcome<DeletionResult>> {
  const now = opts.now?.() ?? new Date();
  const eligibility = await ownAccountEligibility(db, input.userId, opts);
  if (!eligibility.canDelete) return fail(eligibility.status, eligibility.reason);

  if (await isLocked(db, input.userId, now)) return fail(429, SELF_MESSAGES.locked);
  const account = await db
    .prepare(`SELECT 1 AS ok FROM "account" WHERE userId = ? AND providerId = 'credential' AND password IS NOT NULL`)
    .bind(input.userId)
    .first();
  if (!account) return fail(400, SELF_MESSAGES.noPassword);
  if (!(await passwordMatches(db, auth, input.userId, input.password))) {
    await recordFailure(db, input.userId, now);
    return fail(400, SELF_MESSAGES.wrongPassword);
  }

  const outcome = await runDeletion(
    db, { subject: { userId: input.userId }, scope: "account", channel: "autoservicio", performedBy: input.userId }, opts,
  );
  if (outcome.ok) await db.prepare(`DELETE FROM courier_pin_attempts WHERE key = ?`).bind(lockKey(input.userId)).run();
  return outcome;
}
