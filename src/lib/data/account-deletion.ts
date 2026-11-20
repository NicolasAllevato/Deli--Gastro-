/**
 * Eliminación de usuarios de la app (el personal del panel) sobre D1 + Better Auth. docs/eliminacion-datos.md.
 *
 * Borrar un usuario elimina SOLO su cuenta de acceso: user, session, account, verification (por su email o su id) y sus intentos de
 * contraseña. No se toca ninguna otra tabla: pedidos, clientes, puntos, reseñas, pagos, WhatsApp, reclamos y bitácoras quedan como están,
 * y legal_acceptances se conserva (queda con user_id NULL por ON DELETE SET NULL, migración 0019; la ficha de cliente que pudiera
 * tener se desvincula por el trigger de la 0020). El DELETE del usuario lleva `role = 'admin'`: clientes y repartidores no se borran.
 *
 * Dos caminos:
 * - Herramienta del dueño principal (SUPER_OWNER_EMAIL): vista previa → código de un solo uso (HMAC, 5 min, atado al dueño y al usuario
 *   elegido) → ejecución con ese código, la contraseña del dueño y el email exacto del usuario. Se verifica contra la base, no contra la sesión.
 * - Autoservicio: el personal borra su propia cuenta con su contraseña (la palabra ELIMINAR la pide la ruta). Tope de intentos.
 * Nunca se borra al dueño principal ni al último dueño activo: el lote lleva guardas en el mismo SQL (`json('x')` falla y revierte todo).
 * Registro (data_deletion_requests): subject_hash = HMAC-SHA256 del email con DATA_DELETION_HASH_SECRET; nunca el email. Sin ese secreto
 * (o con menos de 32 caracteres) la eliminación queda deshabilitada. El aviso por email al usuario eliminado no condiciona el borrado.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { actorFromRow, isSuperOwnerEmail } from "../auth/owner-rules.ts";
import { normalizeStaffRole, type StaffRole } from "../auth/permissions.ts";
import { BRAND } from "../brand.ts";
import { ForbiddenError, type Actor } from "./actor.ts";
import type { Auth } from "./auth.ts";
import { claimNonce } from "./bot-nonces.ts";
import { nowIso, type SqlDatabase, type SqlStatement, type SqlValue } from "./sql.ts";

export type DeletionChannel = "admin" | "autoservicio";
export const MIN_SECRET_LENGTH = 32;
export const TOKEN_TTL_MS = 5 * 60_000;

export interface DeletionOptions {
  /** Email del dueño principal (SUPER_OWNER_EMAIL); null = sin configurar. */
  superOwnerEmail: string | null;
  /** DATA_DELETION_HASH_SECRET: firma el código de confirmación y hace el hash del registro. */
  hashSecret: string | null;
  /** Aviso al usuario eliminado ("tu cuenta fue eliminada"). Si falla solo se registra. */
  notify?: (email: string) => Promise<void>;
  now?: () => Date;
}

export type DeletionFailure = { ok: false; status: 400 | 403 | 404 | 409 | 429 | 500 | 503; error: string };
export type DeletionOutcome<T> = { ok: true; value: T } | DeletionFailure;
const fail = (status: DeletionFailure["status"], error: string): DeletionFailure => ({ ok: false, status, error });

export const MESSAGES = {
  onlySuper: "Solo el dueño principal puede eliminar usuarios.",
  disabled: "La eliminación de usuarios está deshabilitada: falta configurar DATA_DELETION_HASH_SECRET (mínimo 32 caracteres) en el Worker.",
  superOwner: "Es el dueño principal: no se puede eliminar.",
  lastOwner: "Es el último dueño activo: no se puede eliminar. Antes tiene que haber otro dueño activo.",
  notFound: "No encontramos a ese usuario del personal.",
  badToken: "El código de confirmación venció o no corresponde a este usuario: volvé a hacer la vista previa.",
  tokenUsed: "Ese código de confirmación ya se usó: volvé a hacer la vista previa.",
  emailMismatch: "El email que escribiste no coincide con el del usuario a eliminar.",
  wrongPassword: "La contraseña no es correcta.",
  noPassword: "Esta cuenta no tiene contraseña.",
  locked: "Demasiados intentos con contraseña incorrecta. Probá de nuevo en un rato.",
  retry: "No se pudo eliminar. No se cambió ningún dato; probá de nuevo.",
} as const;

export const SELF_MESSAGES = {
  notStaff: `Solo el personal del local elimina su cuenta desde la aplicación. Los clientes piden la baja por email a ${BRAND.contactEmail}.`,
  superOwner: "Sos el dueño principal: tu cuenta no se puede eliminar desde la aplicación. Para darla de baja hay que cambiar antes el dueño principal en la configuración del sistema.",
  lastOwner: "Sos el único dueño activo: no podés eliminar tu cuenta. Antes creá o activá a otro dueño.",
} as const;

export const KEPT = [
  "Pedidos, con sus datos de entrega", "Clientes, puntos y reseñas", "Conversaciones de WhatsApp y reclamos",
  "Pagos y auditoría de ventas a Fudo", "Bitácoras de pedidos", "Constancias de aceptación legal (quedan sin usuario)",
] as const;

const normalizeEmail = (raw: string | null | undefined): string => (raw ?? "").trim().toLowerCase();
const hmac = (secret: string, data: string): string => createHmac("sha256", secret).update(data).digest("hex");
const secretOf = (opts: DeletionOptions): string | null => (opts.hashSecret && opts.hashSecret.length >= MIN_SECRET_LENGTH ? opts.hashSecret : null);
const nowOf = (opts: DeletionOptions): Date => opts.now?.() ?? new Date();

/** HMAC-SHA256 del email normalizado: lo único del sujeto que llega al registro. */
export const subjectHash = (secret: string, email: string): string => hmac(secret, `subject:email:${normalizeEmail(email)}`);

/** Código de un solo uso: vence a los 5 minutos y solo vale para ESTE dueño y ESTE usuario. `<vencimiento>.<nonce>.<hmac>`. */
export function issueToken(secret: string, actorId: string, targetId: string, nowMs: number): string {
  const expires = nowMs + TOKEN_TTL_MS;
  const nonce = randomUUID();
  return `${expires}.${nonce}.${hmac(secret, `token:${actorId}:${targetId}:${expires}:${nonce}`)}`;
}

export function readToken(secret: string, token: string, actorId: string, targetId: string, nowMs: number): { nonce: string } | null {
  const [expires, nonce, mac, extra] = token.split(".");
  if (extra !== undefined || !expires || !nonce || !mac || !/^\d+$/.test(expires) || Number(expires) < nowMs) return null;
  const expected = Buffer.from(hmac(secret, `token:${actorId}:${targetId}:${expires}:${nonce}`));
  const got = Buffer.from(mac);
  return expected.length === got.length && timingSafeEqual(expected, got) ? { nonce } : null;
}

interface UserRow {
  id: string;
  name: string | null;
  email: string;
  role: string;
  staff_role: string | null;
  banned: number | boolean | null;
  createdAt: string | null;
}

const COLS = `id, name, email, role, staff_role, banned, createdAt`;
const USER_BY_ID = `SELECT ${COLS} FROM "user" WHERE id = ?`;
const USER_BY_EMAIL = `SELECT ${COLS} FROM "user" WHERE email = ? AND role = 'admin'`;
const STAFF_USERS = `SELECT ${COLS} FROM "user" WHERE role = 'admin' ORDER BY name COLLATE NOCASE, email`;

const isBanned = (u: Pick<UserRow, "banned">) => u.banned === 1 || u.banned === true;
const isActiveOwner = (u: UserRow) => u.role === "admin" && !isBanned(u) && normalizeStaffRole(u.staff_role) === "admin";
const ANOTHER_ACTIVE_OWNER = `SELECT 1 AS ok FROM "user" o WHERE o.id <> ? AND o.role = 'admin' AND COALESCE(o.staff_role, 'admin') = 'admin' AND o.banned = 0 LIMIT 1`;
// `json('x')` falla ("malformed JSON") y revierte el lote entero cuando la condición no se cumple.
const OWNER_REMAINS_GUARD = `SELECT json(CASE WHEN EXISTS (${ANOTHER_ACTIVE_OWNER}) THEN '1' ELSE 'x' END)`;
const SUPER_OWNER_GUARD = `SELECT json(CASE WHEN lower((SELECT email FROM "user" WHERE id = ?)) = ? THEN 'x' ELSE '1' END)`;

async function findUser(db: SqlDatabase, id: string): Promise<UserRow | null> {
  return db.prepare(USER_BY_ID).bind(id).first<UserRow>();
}

/** Usuario del personal (role admin) o null: clientes y repartidores no se eliminan por acá. */
async function findStaff(db: SqlDatabase, id: string): Promise<UserRow | null> {
  const u = await findUser(db, id);
  return u && u.role === "admin" ? u : null;
}

/** ¿Algo impide eliminarlo? Dueño principal y último dueño activo. */
async function protectionFor(db: SqlDatabase, u: UserRow, opts: DeletionOptions): Promise<{ status: 403 | 409; reason: string } | null> {
  if (isSuperOwnerEmail(u.email, opts.superOwnerEmail)) return { status: 403, reason: MESSAGES.superOwner };
  if (isActiveOwner(u) && !(await db.prepare(ANOTHER_ACTIVE_OWNER).bind(u.id).first())) return { status: 409, reason: MESSAGES.lastOwner };
  return null;
}

const lockKey = (kind: "delete-account" | "delete-user", id: string) => `${kind}:${id}`;

interface Step {
  key: string;
  label: string;
  count: string;
  del: string;
  binds: (u: UserRow) => SqlValue[];
}

const ids = (u: UserRow): SqlValue[] => [u.id];
/** Todo lo que se elimina, y nada más. */
export const DELETION_STEPS: readonly Step[] = [
  { key: "session", label: "Sesiones abiertas", count: "SELECT COUNT(*) AS n FROM session WHERE userId = ?", del: "DELETE FROM session WHERE userId = ?", binds: ids },
  { key: "account", label: "Credenciales de acceso (contraseña)", count: "SELECT COUNT(*) AS n FROM account WHERE userId = ?", del: "DELETE FROM account WHERE userId = ?", binds: ids },
  {
    key: "verification", label: "Tokens de recuperación y verificación", binds: (u) => [normalizeEmail(u.email), u.id],
    count: "SELECT COUNT(*) AS n FROM verification WHERE lower(identifier) = ? OR value = ?", del: "DELETE FROM verification WHERE lower(identifier) = ? OR value = ?",
  },
  {
    key: "intentos", label: "Intentos de contraseña", binds: (u) => [lockKey("delete-account", u.id)],
    count: "SELECT COUNT(*) AS n FROM courier_pin_attempts WHERE key = ?", del: "DELETE FROM courier_pin_attempts WHERE key = ?",
  },
  { key: "user", label: "Cuenta de usuario", count: `SELECT COUNT(*) AS n FROM "user" WHERE id = ?`, del: `DELETE FROM "user" WHERE id = ? AND role = 'admin'`, binds: ids },
];

async function countsFor(db: SqlDatabase, u: UserRow): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const s of DELETION_STEPS) out[s.key] = Number((await db.prepare(s.count).bind(...s.binds(u)).first<{ n: number }>())?.n ?? 0);
  return out;
}

type Gate = { ok: true; performer: string; secret: string } | DeletionFailure;

/** Solo el dueño principal, verificado contra la base (no contra la sesión), y con el secreto configurado. */
async function gate(db: SqlDatabase, actor: Actor, opts: DeletionOptions): Promise<Gate> {
  if (actor.kind !== "admin") throw new ForbiddenError(MESSAGES.onlySuper);
  const row = await findUser(db, actor.userId);
  if (!row || row.role !== "admin") throw new ForbiddenError(MESSAGES.onlySuper);
  const rules = actorFromRow({ id: row.id, email: row.email, staffRole: row.staff_role, banned: isBanned(row) }, opts.superOwnerEmail);
  if (!rules.isSuper) throw new ForbiddenError(MESSAGES.onlySuper);
  const secret = secretOf(opts);
  return secret ? { ok: true, performer: row.id, secret } : fail(503, MESSAGES.disabled);
}

export interface StaffUserView {
  id: string;
  name: string;
  email: string;
  staffRole: StaffRole;
  banned: boolean;
  createdAt: string | null;
  /** Por qué no se puede eliminar (dueño principal, último dueño), o null. */
  blockedReason: string | null;
}

async function viewOf(db: SqlDatabase, u: UserRow, opts: DeletionOptions): Promise<StaffUserView> {
  return {
    id: u.id, name: u.name ?? "", email: u.email, staffRole: normalizeStaffRole(u.staff_role), banned: isBanned(u),
    createdAt: u.createdAt ? String(u.createdAt) : null, blockedReason: (await protectionFor(db, u, opts))?.reason ?? null,
  };
}

/** Los usuarios del personal, o el que tenga EXACTAMENTE ese email. */
export async function listDeletableUsers(db: SqlDatabase, actor: Actor, opts: DeletionOptions, exactEmail?: string): Promise<DeletionOutcome<StaffUserView[]>> {
  const g = await gate(db, actor, opts);
  if (!g.ok) return g;
  const rows = exactEmail === undefined
    ? (await db.prepare(STAFF_USERS).all<UserRow>()).results
    : (await db.prepare(USER_BY_EMAIL).bind(normalizeEmail(exactEmail)).all<UserRow>()).results;
  return { ok: true, value: await Promise.all(rows.map((u) => viewOf(db, u, opts))) };
}

export interface DeletionPreview {
  user: StaffUserView;
  /** Qué se borra y cuántas filas. */
  deletes: Array<{ key: string; label: string; count: number }>;
  /** Qué se conserva. */
  keeps: readonly string[];
  /** Código de un solo uso para ejecutar (5 minutos); null si el usuario está protegido. */
  token: string | null;
}

export async function previewUserDeletion(db: SqlDatabase, actor: Actor, userId: string, opts: DeletionOptions): Promise<DeletionOutcome<DeletionPreview>> {
  const g = await gate(db, actor, opts);
  if (!g.ok) return g;
  const u = await findStaff(db, userId);
  if (!u) return fail(404, MESSAGES.notFound);
  const user = await viewOf(db, u, opts);
  const counts = await countsFor(db, u);
  return {
    ok: true,
    value: {
      user,
      deletes: DELETION_STEPS.map((s) => ({ key: s.key, label: s.label, count: counts[s.key] })),
      keeps: KEPT,
      token: user.blockedReason ? null : issueToken(g.secret, g.performer, u.id, nowOf(opts).getTime()),
    },
  };
}

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;
const LOCK_MS = 30 * 60_000;

/** 5 contraseñas incorrectas en 15 minutos bloquean 30 (clave propia en courier_pin_attempts: no toca el tope global del PIN). */
async function checkPassword(db: SqlDatabase, auth: Auth, key: string, userId: string, password: string, now: Date): Promise<DeletionFailure | null> {
  const lock = await db.prepare(`SELECT locked_until FROM courier_pin_attempts WHERE key = ?`).bind(key).first<{ locked_until: string | null }>();
  if (lock?.locked_until && lock.locked_until > now.toISOString()) return fail(429, MESSAGES.locked);
  const account = await db.prepare(`SELECT password FROM "account" WHERE userId = ? AND providerId = 'credential'`).bind(userId).first<{ password: string | null }>();
  if (!account?.password) return fail(400, MESSAGES.noPassword);
  if (await (await auth.$context).password.verify({ hash: account.password, password })) return null;
  const stamp = now.toISOString();
  const windowStart = new Date(now.getTime() - WINDOW_MS).toISOString();
  await db
    .prepare(
      `INSERT INTO courier_pin_attempts (key, failures, window_start) VALUES (?, 1, ?)
       ON CONFLICT (key) DO UPDATE SET
         failures     = CASE WHEN window_start < ? THEN 1 ELSE failures + 1 END,
         window_start = CASE WHEN window_start < ? THEN ? ELSE window_start END,
         locked_until = CASE WHEN (CASE WHEN window_start < ? THEN 1 ELSE failures + 1 END) >= ? THEN ? ELSE locked_until END`,
    )
    .bind(key, stamp, windowStart, windowStart, stamp, windowStart, MAX_FAILURES, new Date(now.getTime() + LOCK_MS).toISOString())
    .run();
  return fail(400, MESSAGES.wrongPassword);
}

export interface DeletionResult {
  requestId: string;
  status: "completed";
  /** Filas borradas por paso. */
  counts: Record<string, number>;
  total: number;
  /** Aviso al usuario eliminado: enviado, fallido (el borrado vale igual) u omitido (sin proveedor de correo). */
  notified: "sent" | "failed" | "skipped";
}

/** Corre el borrado ya autorizado: registra, aplica el lote atómico (con las guardas) y avisa al usuario. */
async function run(db: SqlDatabase, u: UserRow, channel: DeletionChannel, performedBy: string, secret: string, opts: DeletionOptions): Promise<DeletionOutcome<DeletionResult>> {
  const blocked = await protectionFor(db, u, opts);
  if (blocked) return fail(blocked.status, blocked.reason);
  const counts = await countsFor(db, u);
  const requestId = randomUUID();
  await db
    .prepare(`INSERT INTO data_deletion_requests (id, subject_hash, channel, requested_at, performed_by, status) VALUES (?, ?, ?, ?, ?, 'pending')`)
    .bind(requestId, subjectHash(secret, u.email), channel, nowOf(opts).toISOString(), performedBy)
    .run();

  const guards: SqlStatement[] = [];
  if (opts.superOwnerEmail) guards.push(db.prepare(SUPER_OWNER_GUARD).bind(u.id, normalizeEmail(opts.superOwnerEmail)));
  if (isActiveOwner(u)) guards.push(db.prepare(OWNER_REMAINS_GUARD).bind(u.id));
  try {
    await db.batch([
      ...guards,
      ...DELETION_STEPS.map((s) => db.prepare(s.del).bind(...s.binds(u))),
      db.prepare(`UPDATE data_deletion_requests SET status = 'completed', completed_at = ?, counts = ? WHERE id = ?`).bind(nowOf(opts).toISOString(), JSON.stringify(counts), requestId),
    ]);
  } catch (e: unknown) {
    console.error("[eliminar-usuario] el lote falló y se revirtió", e instanceof Error ? e.message : "error");
    await db.prepare(`UPDATE data_deletion_requests SET status = 'failed', completed_at = ?, error = ? WHERE id = ?`)
      .bind(nowIso(), "No se aplicó ningún cambio: el lote se revirtió.", requestId).run().catch(() => undefined);
    // Una guarda que saltó entre la verificación y el lote (carrera): se informa igual que la verificación previa.
    const latest = await findUser(db, u.id);
    const again = latest ? await protectionFor(db, latest, opts) : null;
    return again ? fail(again.status, again.reason) : fail(500, MESSAGES.retry);
  }

  let notified: DeletionResult["notified"] = "skipped";
  if (opts.notify) {
    try {
      await opts.notify(u.email);
      notified = "sent";
    } catch (e: unknown) {
      console.error("[eliminar-usuario] no se pudo avisar al usuario", e instanceof Error ? e.message : "error");
      notified = "failed";
    }
  }
  return { ok: true, value: { requestId, status: "completed", counts, total: Object.values(counts).reduce((a, n) => a + n, 0), notified } };
}

/** Eliminación desde la herramienta: código de la vista previa + contraseña del dueño + email exacto del usuario. */
export async function deleteUserAsOwner(
  db: SqlDatabase, auth: Auth, actor: Actor, input: { userId: string; token: string; password: string; confirmEmail: string }, opts: DeletionOptions,
): Promise<DeletionOutcome<DeletionResult>> {
  const g = await gate(db, actor, opts);
  if (!g.ok) return g;
  const u = await findStaff(db, input.userId);
  if (!u) return fail(404, MESSAGES.notFound);
  const blocked = await protectionFor(db, u, opts);
  if (blocked) return fail(blocked.status, blocked.reason);
  const now = nowOf(opts);
  const token = readToken(g.secret, input.token, g.performer, u.id, now.getTime());
  if (!token) return fail(400, MESSAGES.badToken);
  if (normalizeEmail(input.confirmEmail) !== normalizeEmail(u.email)) return fail(400, MESSAGES.emailMismatch);
  const key = lockKey("delete-user", g.performer);
  const wrong = await checkPassword(db, auth, key, g.performer, input.password, now);
  if (wrong) return wrong;
  // Un solo uso: se consume recién con todo lo demás en orden (la contraseña mal puesta no quema el código).
  if (!(await claimNonce(db, `deletion:${token.nonce}`, now.getTime(), TOKEN_TTL_MS / 1000))) return fail(409, MESSAGES.tokenUsed);
  const outcome = await run(db, u, "admin", g.performer, g.secret, opts);
  if (outcome.ok) await db.prepare(`DELETE FROM courier_pin_attempts WHERE key = ?`).bind(key).run();
  return outcome;
}

/** Pedidos de eliminación recientes: sin email, sin hash y sin quién lo hizo. */
export interface DeletionRequestView {
  id: string;
  channel: DeletionChannel | "email";
  status: "pending" | "completed" | "partial" | "failed";
  requestedAt: string;
  completedAt: string | null;
  counts: Record<string, number>;
  total: number;
  error: string | null;
}

export async function listDeletionRequests(db: SqlDatabase, actor: Actor, opts: DeletionOptions): Promise<DeletionRequestView[]> {
  const g = await gate(db, actor, opts);
  if (!g.ok) return [];
  const { results } = await db
    .prepare(`SELECT id, channel, status, requested_at, completed_at, counts, error FROM data_deletion_requests ORDER BY requested_at DESC LIMIT 30`)
    .all<{ id: string; channel: DeletionRequestView["channel"]; status: DeletionRequestView["status"]; requested_at: string; completed_at: string | null; counts: string; error: string | null }>();
  return results.map((r) => {
    let counts: Record<string, number> = {};
    try {
      const parsed: unknown = JSON.parse(r.counts);
      if (parsed && typeof parsed === "object") counts = parsed as Record<string, number>;
    } catch {
      counts = {};
    }
    const total = Object.values(counts).reduce((a, n) => a + Number(n || 0), 0);
    return { id: r.id, channel: r.channel, status: r.status, requestedAt: r.requested_at, completedAt: r.completed_at, counts, total, error: r.error };
  });
}

export type Eligibility = { canDelete: true } | { canDelete: false; status: 403 | 404 | 409 | 503; reason: string };

/** ¿Puede este usuario eliminar su propia cuenta? Solo personal (role admin); ni el dueño principal ni el último dueño activo. */
export async function ownAccountEligibility(db: SqlDatabase, userId: string, opts: DeletionOptions): Promise<Eligibility> {
  if (!secretOf(opts)) return { canDelete: false, status: 503, reason: MESSAGES.disabled };
  const u = await findUser(db, userId);
  if (!u) return { canDelete: false, status: 404, reason: MESSAGES.notFound };
  if (u.role !== "admin") return { canDelete: false, status: 403, reason: SELF_MESSAGES.notStaff };
  const block = await protectionFor(db, u, opts);
  if (block) return { canDelete: false, status: block.status, reason: block.status === 403 ? SELF_MESSAGES.superOwner : SELF_MESSAGES.lastOwner };
  return { canDelete: true };
}

/** Eliminación de la propia cuenta: pide la contraseña actual y borra de inmediato. El usuario sale de la sesión, nunca del pedido. */
export async function deleteOwnAccount(db: SqlDatabase, auth: Auth, input: { userId: string; password: string }, opts: DeletionOptions): Promise<DeletionOutcome<DeletionResult>> {
  const eligibility = await ownAccountEligibility(db, input.userId, opts);
  if (!eligibility.canDelete) return fail(eligibility.status, eligibility.reason);
  const secret = secretOf(opts)!;
  const u = (await findStaff(db, input.userId))!;
  const wrong = await checkPassword(db, auth, lockKey("delete-account", u.id), u.id, input.password, nowOf(opts));
  if (wrong) return wrong;
  return run(db, u, "autoservicio", u.id, secret, opts);
}
