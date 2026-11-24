/**
 * Vencimiento del saldo a favor (módulo PURO, sin base de datos).
 *
 * Cada acreditación (delta > 0) es un «lote» con `expires_at` (NULL = no vence). Los consumos (delta < 0:
 * compra, ajuste negativo) se imputan FIFO: al lote más viejo que todavía no venció en ese momento. Lo que
 * queda sin consumir de un lote vencido se descuenta con un asiento 'vencido' de clave `vence:<id del lote>`
 * (idempotente: el UNIQUE de `idempotency_key` impide descontarlo dos veces).
 */

export interface CreditLedgerLine {
  id: string;
  delta_cents: number;
  motivo: string;
  idempotency_key: string;
  created_at: string;
  expires_at: string | null;
}

export interface CreditLot {
  id: string;
  createdAt: string;
  expiresAt: string | null;
  initialCents: number;
  remainingCents: number;
  /** Ya hay un asiento 'vencido' para este lote. */
  booked: boolean;
}

export interface Expiration {
  lotId: string;
  amountCents: number;
  idempotencyKey: string;
}

export const VENCIDO_PREFIX = "vence:";
export const vencidoKey = (lotId: string): string => `${VENCIDO_PREFIX}${lotId}`;

const ms = (iso: string): number => Date.parse(iso);

/** Vencimiento de una acreditación hecha en `createdAt`: `days` días después (mismo formato ISO que usa la base). null = no vence. */
export function expiryFrom(createdAt: string, days: number): string | null {
  const t = ms(createdAt);
  if (!Number.isFinite(t) || !Number.isInteger(days) || days <= 0) return null;
  return new Date(t + days * 86_400_000).toISOString();
}

/** Orden cronológico estable: a igual instante, primero las acreditaciones (un débito no puede preceder a su crédito). */
function chronological(rows: readonly CreditLedgerLine[]): CreditLedgerLine[] {
  return [...rows].sort((a, b) => {
    const d = ms(a.created_at) - ms(b.created_at);
    if (d !== 0) return d;
    const sign = Number(b.delta_cents > 0) - Number(a.delta_cents > 0);
    if (sign !== 0) return sign;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

const expiredAt = (lot: CreditLot, instant: number): boolean => lot.expiresAt !== null && ms(lot.expiresAt) <= instant;

/**
 * Reconstruye el remanente de cada lote aplicando los movimientos en orden.
 * Un consumo toma primero de los lotes vivos en ese instante (el más viejo primero); solo si no alcanzan toma de
 * lotes ya vencidos pero todavía no descontados (el saldo seguía a disposición porque el proceso no había corrido).
 */
export function lotsOf(rows: readonly CreditLedgerLine[]): CreditLot[] {
  const lots: CreditLot[] = [];
  const byId = new Map<string, CreditLot>();
  for (const row of chronological(rows)) {
    if (row.delta_cents > 0) {
      const lot: CreditLot = {
        id: row.id,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        initialCents: row.delta_cents,
        remainingCents: row.delta_cents,
        booked: false,
      };
      lots.push(lot);
      byId.set(lot.id, lot);
      continue;
    }
    if (row.delta_cents === 0) continue;
    const amount = -row.delta_cents;
    const target = row.motivo === "vencido" && row.idempotency_key.startsWith(VENCIDO_PREFIX) ? byId.get(row.idempotency_key.slice(VENCIDO_PREFIX.length)) : undefined;
    if (target) {
      target.remainingCents = Math.max(0, target.remainingCents - amount);
      target.booked = true;
      continue;
    }
    const instant = ms(row.created_at);
    let need = amount;
    for (const pass of [0, 1] as const) {
      for (const lot of lots) {
        if (need === 0) break;
        if (lot.remainingCents === 0 || lot.booked) continue;
        if (pass === 0 && expiredAt(lot, instant)) continue;
        const take = Math.min(need, lot.remainingCents);
        lot.remainingCents -= take;
        need -= take;
      }
    }
  }
  return lots;
}

/** Qué hay que descontar ahora por vencimiento: el remanente de cada lote vencido y todavía no descontado. */
export function planExpirations(rows: readonly CreditLedgerLine[], nowIso: string): Expiration[] {
  const now = ms(nowIso);
  if (!Number.isFinite(now)) return [];
  return lotsOf(rows)
    .filter((lot) => !lot.booked && lot.remainingCents > 0 && expiredAt(lot, now))
    .map((lot) => ({ lotId: lot.id, amountCents: lot.remainingCents, idempotencyKey: vencidoKey(lot.id) }));
}
