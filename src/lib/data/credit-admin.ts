/**
 * Saldo a favor, lado administración (migración 0025): configuración (tope por reclamo y vencimiento), proceso de
 * vencimiento, búsqueda de clientes, historial y carga manual. Todo en centavos. Solo personal/sistema.
 */
import { requireStaff, type Actor } from "./actor.ts";
import { addCredit, InsufficientCreditError } from "./credit.ts";
import { assertCents } from "./money.ts";
import type { SqlDatabase } from "./sql.ts";
import { planExpirations, vencidoKey, type CreditLedgerLine } from "../credit-expiry.ts";

export const TOPE_KEY = "saldo_tope_reclamo_cents";
export const VENCIMIENTO_KEY = "saldo_vencimiento_dias";
/** Topes de cordura de lo que se puede configurar. */
export const MAX_TOPE_CENTS = 100_000_000; // $1.000.000
export const MAX_VENCIMIENTO_DIAS = 3650;
export const MAX_AJUSTE_CENTS = 100_000_000;

export interface CreditConfig {
  /** Máximo de saldo por reclamo en centavos; 0 = sin tope. */
  topeCents: number;
  /** Días de vigencia de cada acreditación; 0 = no vence. */
  vencimientoDias: number;
}

function intOr0(raw: string | undefined, max: number): number {
  if (raw === undefined) return 0;
  try {
    const n = Number(JSON.parse(raw));
    return Number.isInteger(n) && n > 0 ? Math.min(n, max) : 0;
  } catch {
    return 0;
  }
}

export async function readCreditConfig(db: SqlDatabase, actor: Actor): Promise<CreditConfig> {
  requireStaff(actor);
  const { results } = await db
    .prepare("SELECT key, value FROM global_config WHERE key IN (?, ?)")
    .bind(TOPE_KEY, VENCIMIENTO_KEY)
    .all<{ key: string; value: string }>();
  const byKey = new Map(results.map((r) => [r.key, r.value]));
  return { topeCents: intOr0(byKey.get(TOPE_KEY), MAX_TOPE_CENTS), vencimientoDias: intOr0(byKey.get(VENCIMIENTO_KEY), MAX_VENCIMIENTO_DIAS) };
}

export async function writeCreditConfig(db: SqlDatabase, actor: Actor, config: CreditConfig): Promise<CreditConfig> {
  requireStaff(actor);
  if (!Number.isSafeInteger(config.topeCents) || config.topeCents < 0 || config.topeCents > MAX_TOPE_CENTS) throw new Error("Tope inválido");
  if (!Number.isSafeInteger(config.vencimientoDias) || config.vencimientoDias < 0 || config.vencimientoDias > MAX_VENCIMIENTO_DIAS) throw new Error("Vencimiento inválido");
  const upsert = (key: string, value: number) =>
    db
      .prepare(
        `INSERT INTO global_config (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .bind(key, JSON.stringify(value));
  await db.batch([upsert(TOPE_KEY, config.topeCents), upsert(VENCIMIENTO_KEY, config.vencimientoDias)]);
  return config;
}

/* ------------------------------------------------------------------ vencimiento */

export interface ExpireResult {
  clients: number;
  expiredLots: number;
  expiredCents: number;
}

async function expireClient(db: SqlDatabase, clientId: string, nowIso: string): Promise<{ lots: number; cents: number }> {
  const { results } = await db
    .prepare("SELECT id, delta_cents, motivo, idempotency_key, created_at, expires_at FROM credit_ledger WHERE client_id = ? ORDER BY created_at, id")
    .bind(clientId)
    .all<CreditLedgerLine>();
  let lots = 0;
  let cents = 0;
  for (const e of planExpirations(results, nowIso)) {
    // Un solo INSERT condicionado al saldo: si en el medio se gastó y ya no alcanza, no inserta (se reintenta en la próxima corrida)
    // y el saldo nunca queda negativo. La clave `vence:<lote>` impide descontar dos veces.
    const r = await db
      .prepare(
        `INSERT INTO credit_ledger (id, client_id, delta_cents, motivo, description, idempotency_key, created_at)
         SELECT ?, ?, ?, 'vencido', ?, ?, ? WHERE (SELECT credit_cents FROM clients WHERE id = ?) >= ?
         ON CONFLICT (idempotency_key) DO NOTHING`,
      )
      .bind(crypto.randomUUID(), clientId, -e.amountCents, "Saldo vencido", vencidoKey(e.lotId), nowIso, clientId, e.amountCents)
      .run();
    if (r.meta.changes === 1) {
      lots += 1;
      cents += e.amountCents;
    }
  }
  return { lots, cents };
}

/**
 * Descuenta el saldo de las acreditaciones vencidas (idempotente). Con `clientId` solo ese cliente; sin él, los que
 * tengan algo vencido sin descontar (hasta `limit` por corrida: el cron la repite cada 15 minutos).
 */
export async function expireCredits(db: SqlDatabase, actor: Actor, opts: { clientId?: string; now?: Date; limit?: number } = {}): Promise<ExpireResult> {
  requireStaff(actor);
  const nowIso = (opts.now ?? new Date()).toISOString();
  let ids: string[];
  if (opts.clientId) {
    ids = [opts.clientId];
  } else {
    const { results } = await db
      .prepare(
        `SELECT DISTINCT l.client_id FROM credit_ledger l
         WHERE l.delta_cents > 0 AND l.expires_at IS NOT NULL AND l.expires_at <= ?
           AND NOT EXISTS (SELECT 1 FROM credit_ledger v WHERE v.idempotency_key = 'vence:' || l.id)
         LIMIT ?`,
      )
      .bind(nowIso, Math.min(Math.max(opts.limit ?? 200, 1), 500))
      .all<{ client_id: string }>();
    ids = results.map((r) => r.client_id);
  }
  const out: ExpireResult = { clients: 0, expiredLots: 0, expiredCents: 0 };
  for (const id of ids) {
    const r = await expireClient(db, id, nowIso);
    if (r.lots > 0) out.clients += 1;
    out.expiredLots += r.lots;
    out.expiredCents += r.cents;
  }
  return out;
}

/* ------------------------------------------------------------------ clientes e historial */

export interface CreditClient {
  id: string;
  name: string;
  phone: string | null;
  creditCents: number;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Busca por nombre o por teléfono (dígitos). Sin término, los clientes que hoy tienen saldo. */
export async function searchCreditClients(db: SqlDatabase, actor: Actor, query: string, limit = 20): Promise<CreditClient[]> {
  requireStaff(actor);
  const q = query.trim().slice(0, 80);
  const max = Math.min(Math.max(limit, 1), 50);
  const digits = q.replace(/\D/g, "");
  const rows =
    q === ""
      ? await db
          .prepare("SELECT id, name, phone, credit_cents FROM clients WHERE credit_cents > 0 AND is_anonymous = 0 ORDER BY credit_cents DESC, name LIMIT ?")
          .bind(max)
          .all<{ id: string; name: string; phone: string | null; credit_cents: number }>()
      : await db
          .prepare(
            `SELECT id, name, phone, credit_cents FROM clients
             WHERE is_anonymous = 0 AND (name LIKE ? ESCAPE '\\' OR (? <> '' AND phone_digits LIKE ? ESCAPE '\\'))
             ORDER BY name LIMIT ?`,
          )
          .bind(`%${escapeLike(q)}%`, digits.length >= 3 ? digits : "", `%${escapeLike(digits)}%`, max)
          .all<{ id: string; name: string; phone: string | null; credit_cents: number }>();
  return rows.results.map((r) => ({ id: r.id, name: r.name, phone: r.phone, creditCents: assertCents(r.credit_cents, "credit_cents") }));
}

export interface CreditHistoryRow {
  id: string;
  deltaCents: number;
  motivo: string;
  description: string | null;
  orderId: string | null;
  reclamoId: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface CreditHistory {
  client: CreditClient;
  movements: CreditHistoryRow[];
}

/** Historial del cliente, del más nuevo al más viejo. Antes descuenta lo vencido para que el saldo mostrado sea el real. */
export async function creditHistory(db: SqlDatabase, actor: Actor, clientId: string, limit = 100): Promise<CreditHistory | null> {
  requireStaff(actor);
  await expireCredits(db, actor, { clientId });
  const c = await db
    .prepare("SELECT id, name, phone, credit_cents FROM clients WHERE id = ?")
    .bind(clientId)
    .first<{ id: string; name: string; phone: string | null; credit_cents: number }>();
  if (!c) return null;
  const { results } = await db
    .prepare(
      `SELECT id, delta_cents, motivo, description, order_id, reclamo_id, created_at, expires_at FROM credit_ledger
       WHERE client_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(clientId, Math.min(Math.max(limit, 1), 500))
    .all<{ id: string; delta_cents: number; motivo: string; description: string | null; order_id: string | null; reclamo_id: string | null; created_at: string; expires_at: string | null }>();
  return {
    client: { id: c.id, name: c.name, phone: c.phone, creditCents: assertCents(c.credit_cents, "credit_cents") },
    movements: results.map((r) => ({
      id: r.id, deltaCents: r.delta_cents, motivo: r.motivo, description: r.description, orderId: r.order_id, reclamoId: r.reclamo_id,
      createdAt: r.created_at, expiresAt: r.expires_at,
    })),
  };
}

/* ------------------------------------------------------------------ carga manual */

export class AdjustmentError extends Error {
  readonly kind: "motivo" | "monto" | "cliente" | "saldo";
  constructor(message: string, kind: "motivo" | "monto" | "cliente" | "saldo") {
    super(message);
    this.kind = kind;
    this.name = "AdjustmentError";
  }
}

export interface AdjustmentInput {
  clientId: string;
  /** Centavos: positivo suma, negativo resta. */
  deltaCents: number;
  reason: string;
  /** Identifica la operación (uuid del formulario): reenviarla no duplica el movimiento. */
  idempotencyKey: string;
  /** Nombre o email de quien lo hace, para el registro. */
  adminLabel: string;
}

export interface AdjustmentResult {
  /** false si esa operación ya se había registrado (reintento). */
  applied: boolean;
  balanceCents: number;
}

/** Suma o resta saldo con un motivo obligatorio. Nunca deja el saldo negativo. Asienta motivo 'ajuste' con quién y cuándo. */
export async function adjustCredit(db: SqlDatabase, actor: Actor, input: AdjustmentInput, now: Date = new Date()): Promise<AdjustmentResult> {
  requireStaff(actor);
  const reason = input.reason.trim();
  if (!reason) throw new AdjustmentError("El motivo es obligatorio.", "motivo");
  if (!Number.isSafeInteger(input.deltaCents) || input.deltaCents === 0 || Math.abs(input.deltaCents) > MAX_AJUSTE_CENTS) {
    throw new AdjustmentError("El monto debe ser distinto de cero y razonable.", "monto");
  }
  const client = await db.prepare("SELECT id FROM clients WHERE id = ?").bind(input.clientId).first<{ id: string }>();
  if (!client) throw new AdjustmentError("No se encontró el cliente.", "cliente");
  // El saldo real: sin esto se podría «gastar» saldo vencido que todavía no se descontó.
  await expireCredits(db, actor, { clientId: input.clientId, now });
  const who = input.adminLabel.trim() || "admin";
  try {
    const applied = await addCredit(db, actor, {
      id: crypto.randomUUID(),
      clientId: input.clientId,
      deltaCents: input.deltaCents,
      motivo: "ajuste",
      idempotencyKey: `ajuste:${input.idempotencyKey}`,
      description: `${reason} — cargado por ${who} el ${now.toISOString()}`,
    });
    const row = await db.prepare("SELECT credit_cents FROM clients WHERE id = ?").bind(input.clientId).first<{ credit_cents: number }>();
    return { applied, balanceCents: assertCents(row?.credit_cents ?? 0, "credit_cents") };
  } catch (err) {
    if (err instanceof InsufficientCreditError) throw new AdjustmentError("El cliente no tiene saldo suficiente: el saldo no puede quedar negativo.", "saldo");
    throw err;
  }
}
