/**
 * Escrituras de ventas en Fudo (API pública v1alpha1). Ver GUIA_INTEGRACION_FUDO §2.4, §2.5, §7.3, §8 y §9.
 *
 * - Gate ENABLE_WRITES: cualquier escritura con ENABLE_WRITES !== "true" → 403 WRITES_DISABLED.
 * - Auth: HMAC (FUDO_GATEWAY_SECRET) de `MÉTODO path\nts\ncuerpo`; `ts` (x-gateway-ts) vale ±5 min.
 *   Firmar método y path impide reusar la firma de un pago para crear una venta.
 * - Sin reintentos: un POST financiero repetido puede duplicar dinero.
 * - Fudo no acepta saleType DELIVERY: todo va como TAKEAWAY y el delivery deja dirección y teléfono en comment.
 * - Venta y líneas no son atómicas: si falla una línea → partial:true y la venta queda abierta (revisión manual).
 */
import { FudoError, publicWrite, type FudoEnv } from "./fudo.ts";
import { verifyHmacHex } from "./signature.ts";

export interface WriteEnv extends FudoEnv {
  FUDO_GATEWAY_SECRET: string;
  /** "true" habilita las escrituras hacia el Fudo de producción. Cualquier otro valor las bloquea. */
  ENABLE_WRITES?: string;
  /** Rate limiting de Cloudflare (opcional): si no está, se usa un contador por isolate. */
  RATE_LIMIT_WRITES?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

export const MAX_SALE_LINES = 100;
const MAX_BODY_BYTES = 256 * 1024;
const SIGNATURE_WINDOW_MS = 5 * 60_000;
const WRITES_PER_MINUTE = 20;
/** Venta ya creada para un pedido de la app: 30 días alcanzan para cualquier reintento. */
const SALE_KEY_TTL_SECONDS = 30 * 24 * 60 * 60;
const ID_RE = /^\d{1,10}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ok = (data: unknown, status = 200): Response => json({ success: true, data, error: null }, status);
const fail = (error: string, status: number, details?: Record<string, unknown>): Response =>
  json({ success: false, data: null, error, ...(details ? { details } : {}) }, status);

export function writeSignaturePayload(method: string, path: string, ts: string, body: string): string {
  return `${method.toUpperCase()} ${path}\n${ts}\n${body}`;
}

// ---------------------------------------------------------------------------
// Rate limit
// ---------------------------------------------------------------------------
let windowStart = 0;
let windowCount = 0;

/** Solo para tests. */
export function resetWriteRateLimit(): void {
  windowStart = 0;
  windowCount = 0;
}

async function allowWrite(env: WriteEnv): Promise<boolean> {
  if (env.RATE_LIMIT_WRITES) return (await env.RATE_LIMIT_WRITES.limit({ key: "app-writes" })).success;
  const now = Date.now();
  if (now - windowStart >= 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  windowCount += 1;
  return windowCount <= WRITES_PER_MINUTE;
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Id de Fudo: número o string de 1 a 10 dígitos (evita path traversal tipo `..%2f`). */
export function fudoId(v: unknown): number | null {
  const s = typeof v === "number" && Number.isInteger(v) ? String(v) : typeof v === "string" ? v : "";
  if (!ID_RE.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const amount = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100_000_000 ? v : null);

export interface SaleLine {
  fudoProductId: number;
  quantity: number;
  price: number | null;
  comment: string | null;
}

export interface CreateSaleInput {
  externalId: string;
  lines: SaleLine[];
  customerName: string | null;
  comment: string | null;
  delivery: { address: string | null; phone: string | null } | null;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseCreateSale(raw: unknown): Parsed<CreateSaleInput> {
  if (!isObj(raw)) return { ok: false, error: "Cuerpo inválido." };
  if (typeof raw.externalId !== "string" || !UUID_RE.test(raw.externalId)) return { ok: false, error: "externalId inválido." };
  if (!Array.isArray(raw.lines) || raw.lines.length === 0) return { ok: false, error: "La venta necesita al menos una línea." };
  if (raw.lines.length > MAX_SALE_LINES) return { ok: false, error: `Máximo ${MAX_SALE_LINES} líneas por venta.` };
  const lines: SaleLine[] = [];
  for (const l of raw.lines) {
    if (!isObj(l)) return { ok: false, error: "Línea inválida." };
    const id = fudoId(l.fudoProductId);
    const qty = typeof l.quantity === "number" && Number.isInteger(l.quantity) && l.quantity > 0 && l.quantity <= 999 ? l.quantity : null;
    if (id === null || qty === null) return { ok: false, error: "Línea con producto o cantidad inválidos." };
    const price = l.price === undefined || l.price === null ? null : amount(l.price);
    if (l.price !== undefined && l.price !== null && price === null) return { ok: false, error: "Precio inválido." };
    lines.push({ fudoProductId: id, quantity: qty, price, comment: text(l.comment, 200) });
  }
  const d = isObj(raw.delivery) ? raw.delivery : null;
  return {
    ok: true,
    value: {
      externalId: raw.externalId.toLowerCase(),
      lines,
      customerName: text(raw.customerName, 80),
      comment: text(raw.comment, 300),
      delivery: d ? { address: text(d.address, 200), phone: text(d.phone, 40) } : null,
    },
  };
}

export function saleComment(input: CreateSaleInput): string {
  const parts = [`Pedido app #${input.externalId.slice(0, 8)}`];
  if (input.delivery) {
    parts.push("DELIVERY");
    if (input.delivery.address) parts.push(`Dirección: ${input.delivery.address}`);
    if (input.delivery.phone) parts.push(`Tel: ${input.delivery.phone}`);
  }
  if (input.comment) parts.push(input.comment);
  return parts.join(" | ").slice(0, 500);
}

// ---------------------------------------------------------------------------
// Llamadas a Fudo
// ---------------------------------------------------------------------------
async function createdId(res: Response, what: string): Promise<number> {
  const raw = await res.text();
  if (res.status !== 200 && res.status !== 201) {
    // El cuerpo crudo va al log; al cliente solo el estado.
    console.error(`[fudo.write] ${what} ${res.status}`, raw.slice(0, 500));
    throw new FudoError(`Fudo ${what} respondió ${res.status}`, res.status, res.status >= 400 && res.status < 500);
  }
  let id: number | null = null;
  try {
    const body = JSON.parse(raw) as { data?: { id?: unknown } };
    id = fudoId(body.data?.id);
  } catch {
    id = null;
  }
  if (id === null) throw new FudoError(`Fudo ${what} no devolvió id`, 502, false);
  return id;
}

const rel = (type: string, id: number) => ({ data: { type, id: String(id) } });

export interface CreateSaleResult {
  saleId: number;
  partial: boolean;
  linesCreated: number;
  /** Índices (base 0) de las líneas que Fudo rechazó. */
  failedLines: number[];
  /** true: la venta ya existía para este pedido y no se creó otra. */
  existing: boolean;
}

const saleKey = (externalId: string) => `fudo:sale-ext:${externalId}`;

export async function createSale(env: WriteEnv, input: CreateSaleInput): Promise<CreateSaleResult> {
  const known = await env.FUDO_KV.get(saleKey(input.externalId));
  const knownId = known ? fudoId(known) : null;
  if (knownId !== null) return { saleId: knownId, partial: false, linesCreated: 0, failedLines: [], existing: true };

  const attributes: Record<string, unknown> = { saleType: "TAKEAWAY", comment: saleComment(input) };
  if (input.customerName) attributes.customerName = input.customerName;
  const saleId = await createdId(await publicWrite(env, "POST", "sales", { data: { type: "Sale", attributes } }), "POST /sales");
  // Se guarda antes de las líneas: si algo falla más adelante, un reintento nunca crea una segunda venta.
  await env.FUDO_KV.put(saleKey(input.externalId), String(saleId), { expirationTtl: SALE_KEY_TTL_SECONDS });

  const failedLines: number[] = [];
  let linesCreated = 0;
  for (const [i, line] of input.lines.entries()) {
    const attrs: Record<string, unknown> = { quantity: line.quantity };
    if (line.price !== null) attrs.price = line.price;
    if (line.comment) attrs.comment = line.comment;
    try {
      await createdId(
        await publicWrite(env, "POST", "items", {
          data: { type: "Item", attributes: attrs, relationships: { sale: rel("Sale", saleId), product: rel("Product", line.fudoProductId) } },
        }),
        "POST /items",
      );
      linesCreated += 1;
    } catch (e) {
      console.error("[fudo.write] línea", i, e instanceof Error ? e.message : String(e));
      failedLines.push(i);
    }
  }
  return { saleId, partial: failedLines.length > 0, linesCreated, failedLines, existing: false };
}

export const SALE_STATES = ["CLOSED", "CANCELED"] as const;
export type SaleState = (typeof SALE_STATES)[number];

export async function setSaleState(env: WriteEnv, saleId: number, state: SaleState): Promise<void> {
  const res = await publicWrite(env, "PATCH", `sales/${saleId}`, { data: { type: "Sale", id: String(saleId), attributes: { saleState: state } } });
  if (!res.ok) {
    console.error("[fudo.write] PATCH /sales", res.status, (await res.text()).slice(0, 500));
    throw new FudoError(`Fudo PATCH /sales respondió ${res.status}`, res.status, res.status >= 400 && res.status < 500);
  }
}

const paymentKey = (saleId: number) => `fudo:payment-sale:${saleId}`;

/** Un pago por venta: un reintento (timeout del lado de la app) devuelve el pago ya creado y no cobra dos veces. */
export async function createPaymentOnce(env: WriteEnv, saleId: number, paymentMethodId: number, value: number): Promise<{ paymentId: number; existing: boolean }> {
  const known = await env.FUDO_KV.get(paymentKey(saleId));
  const knownId = known ? fudoId(known) : null;
  if (knownId !== null) return { paymentId: knownId, existing: true };
  const paymentId = await createPayment(env, saleId, paymentMethodId, value);
  await env.FUDO_KV.put(paymentKey(saleId), String(paymentId), { expirationTtl: SALE_KEY_TTL_SECONDS });
  return { paymentId, existing: false };
}

export async function createPayment(env: WriteEnv, saleId: number, paymentMethodId: number, value: number): Promise<number> {
  return createdId(
    await publicWrite(env, "POST", "payments", {
      data: {
        type: "Payment",
        attributes: { amount: value },
        relationships: { sale: rel("Sale", saleId), paymentMethod: rel("PaymentMethod", paymentMethodId) },
      },
    }),
    "POST /payments",
  );
}

// ---------------------------------------------------------------------------
// Router de escrituras
// ---------------------------------------------------------------------------
const STATE_PATH = /^\/sales\/([^/]+)\/state$/;

/** ¿Es una ruta de escritura de ventas? Devuelve null si no corresponde a este módulo. */
export function isWriteRoute(method: string, pathname: string): boolean {
  return (method === "POST" && (pathname === "/sales" || pathname === "/payments")) || (method === "PATCH" && STATE_PATH.test(pathname));
}

function errorResponse(e: unknown): Response {
  if (e instanceof FudoError && e.permanent) return fail("Fudo rechazó la operación.", 422, { status: e.status });
  return fail("Fudo no respondió correctamente.", 502);
}

export async function handleWrite(request: Request, env: WriteEnv): Promise<Response> {
  const { pathname } = new URL(request.url);
  const raw = await request.text();
  const ts = request.headers.get("x-gateway-ts") ?? "";
  const tsNum = Number(ts);
  const fresh = /^\d{10,16}$/.test(ts) && Math.abs(Date.now() - tsNum) <= SIGNATURE_WINDOW_MS;
  const signature = request.headers.get("x-gateway-signature");
  if (!fresh || !(await verifyHmacHex(writeSignaturePayload(request.method, pathname, ts, raw), signature, env.FUDO_GATEWAY_SECRET))) {
    return fail("Firma inválida.", 401);
  }
  if (!(await allowWrite(env))) return fail("Demasiadas escrituras.", 429);
  if (env.ENABLE_WRITES !== "true") return fail("Escrituras en Fudo deshabilitadas.", 403, { code: "WRITES_DISABLED" });
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return fail("Cuerpo demasiado grande.", 413);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail("JSON inválido.", 400);
  }

  try {
    if (pathname === "/sales") {
      const parsed = parseCreateSale(body);
      if (!parsed.ok) return fail(parsed.error, 400);
      const result = await createSale(env, parsed.value);
      return ok(result, result.existing ? 200 : 201);
    }
    if (pathname === "/payments") {
      const b = isObj(body) ? body : {};
      const saleId = fudoId(b.saleId);
      const methodId = fudoId(b.paymentMethodId);
      const value = amount(b.amount);
      if (saleId === null || methodId === null || value === null || value === 0) return fail("Pago inválido.", 400);
      const payment = await createPaymentOnce(env, saleId, methodId, value);
      return ok(payment, payment.existing ? 200 : 201);
    }
    const saleId = fudoId(STATE_PATH.exec(pathname)?.[1]);
    if (saleId === null) return fail("Id de venta inválido.", 404);
    const state = isObj(body) ? body.state : undefined;
    if (!(SALE_STATES as readonly unknown[]).includes(state)) return fail("Estado inválido.", 400);
    await setSaleState(env, saleId, state as SaleState);
    return ok({ saleId, state });
  } catch (e) {
    console.error("[fudo.write]", pathname, e instanceof Error ? e.message : String(e));
    return errorResponse(e);
  }
}
