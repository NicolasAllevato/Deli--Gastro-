/**
 * Ventas de Fudo -> pedidos de Deli-Gastro (`channel = 'fudo'`). Sin I/O: parseo de la API pública (JSON:API)
 * y plan de cambios. Solo se importan delivery y take away; el salón (EAT-IN) no es parte del tablero.
 * Reglas:
 *  - una venta se importa una sola vez (`orders.fudo_order_id` es único);
 *  - el estado solo avanza (nunca se retrocede lo que el admin movió en el tablero);
 *  - los pedidos que la app misma envió a Fudo no se tocan: su estado lo maneja la app.
 * Ver docs/FUDO_INTEGRACION.md.
 */

export type BoardStatus = "Recibidos" | "En Preparación" | "En Camino" | "Finalizados" | "Cancelado";
export type FudoSaleType = "DELIVERY" | "TAKEAWAY" | "EAT-IN";

export interface FudoSale {
  id: number;
  createdAt: string;
  total: number;
  saleType: FudoSaleType;
  saleState: string;
  customerId: number | null;
  anon: { name: string | null; phone: string | null; address: string | null } | null;
  customerName: string | null;
  comment: string | null;
  itemIds: number[];
}

export interface FudoItem {
  id: number;
  productId: number | null;
  quantity: number;
  price: number;
  canceled: boolean;
  comment: string | null;
}

type Entry = Record<string, unknown>;
const isObject = (v: unknown): v is Entry => typeof v === "object" && v !== null && !Array.isArray(v);

function positiveInt(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function relId(e: Entry, name: string): number | null {
  const rel = isObject(e.relationships) ? e.relationships[name] : undefined;
  return isObject(rel) && isObject(rel.data) ? positiveInt(rel.data.id) : null;
}

function relIds(e: Entry, name: string): number[] {
  const rel = isObject(e.relationships) ? e.relationships[name] : undefined;
  const data = isObject(rel) ? rel.data : undefined;
  if (!Array.isArray(data)) return [];
  // Fudo devuelve las to-many como `[{id,type}]` o como `[{data:{id,type}}]` (ver auditoría de CRM-FRANKIE).
  return data
    .map((d) => (isObject(d) ? positiveInt(isObject(d.data) ? d.data.id : d.id) : null))
    .filter((n): n is number => n !== null);
}

const SALE_TYPES: readonly FudoSaleType[] = ["DELIVERY", "TAKEAWAY", "EAT-IN"];

export function parseFudoSales(raw: unknown): FudoSale[] {
  const list = isObject(raw) && Array.isArray(raw.data) ? raw.data : Array.isArray(raw) ? raw : [];
  const out: FudoSale[] = [];
  for (const e of list) {
    if (!isObject(e) || !isObject(e.attributes)) continue;
    const id = positiveInt(e.id);
    const a = e.attributes;
    const saleType = SALE_TYPES.find((t) => t === a.saleType);
    if (id === null || !saleType) continue;
    const anon = isObject(a.anonymousCustomer)
      ? { name: str(a.anonymousCustomer.name), phone: str(a.anonymousCustomer.phone), address: str(a.anonymousCustomer.address) }
      : null;
    out.push({
      id,
      createdAt: str(a.createdAt) ?? new Date().toISOString(),
      total: num(a.total),
      saleType,
      saleState: str(a.saleState) ?? "IN-COURSE",
      customerId: relId(e, "customer"),
      anon,
      customerName: str(a.customerName),
      comment: str(a.comment),
      itemIds: relIds(e, "items"),
    });
  }
  return out;
}

/** Respuesta de `GET /items/{id}` (o un elemento de una lista). */
export function parseFudoItem(raw: unknown): FudoItem | null {
  const e = isObject(raw) && isObject(raw.data) ? raw.data : raw;
  if (!isObject(e) || !isObject(e.attributes)) return null;
  const id = positiveInt(e.id);
  if (id === null) return null;
  const a = e.attributes;
  return {
    id,
    productId: relId(e, "product"),
    quantity: Math.max(1, Math.round(num(a.quantity) || 1)),
    price: num(a.price),
    canceled: a.canceled === true,
    comment: str(a.comment),
  };
}

/** Clave de teléfono para emparejar: solo dígitos, los últimos 10 (iguala +54 9 11… con 11…). */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(-10) : null;
}

/** Fudo guarda la dirección como string con un array JSON (`["calle","nro","extra","ciudad"]`). */
export function parseFudoAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const parts = JSON.parse(raw) as unknown;
    if (Array.isArray(parts)) {
      // Orden de Fudo: calle, número, extra (piso/depto), ciudad. Calle y número van juntos.
      const clean = parts.map((p) => (typeof p === "string" ? p.trim() : "")).map((p) => (p === "-" ? "" : p));
      const head = [clean[0], clean[1]].filter(Boolean).join(" ");
      const out = [head, ...clean.slice(2)].filter(Boolean).join(", ");
      return out || null;
    }
  } catch {
    // No era JSON: se usa tal cual.
  }
  return raw.trim() && raw.trim() !== "-" ? raw.trim() : null;
}

export function mapSaleState(state: string): BoardStatus {
  switch (state) {
    case "PAYMENT-PROCESS":
    case "READY-TO-DELIVER":
      return "En Preparación";
    case "DELIVERY-SENT":
      return "En Camino";
    case "CLOSED":
      return "Finalizados";
    case "CANCELED":
      return "Cancelado";
    default:
      return "Recibidos";
  }
}

const RANK: Record<BoardStatus, number> = { Recibidos: 0, "En Preparación": 1, "En Camino": 2, Finalizados: 3, Cancelado: 3 };

/** Próximo estado: solo avanza; lo terminado (Finalizados/Cancelado) no cambia. */
export function nextStatus(current: BoardStatus, target: BoardStatus): BoardStatus {
  if (current === "Finalizados" || current === "Cancelado") return current;
  if (target === "Cancelado") return "Cancelado";
  return RANK[target] > RANK[current] ? target : current;
}

/** Rango explícito para importar ventas viejas (backfill). Máximo `MAX_RANGE_DAYS` por corrida. */
export interface SalesRange {
  from: Date;
  to: Date;
}
export const MAX_RANGE_DAYS = 7;

/** Lee `from`/`to` (ISO) de la query. `null` si no vienen; lanza si son inválidos o el rango es muy largo. */
export function parseSalesRange(params: URLSearchParams): SalesRange | null {
  const rawFrom = params.get("from");
  const rawTo = params.get("to");
  if (!rawFrom && !rawTo) return null;
  const from = new Date(rawFrom ?? "");
  const to = new Date(rawTo ?? "");
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new Error("from/to inválidos (ISO 8601).");
  if (to <= from) throw new Error("to tiene que ser posterior a from.");
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) throw new Error(`El rango no puede pasar de ${MAX_RANGE_DAYS} días.`);
  return { from, to };
}

export interface OrderLineInsert {
  product_id: string | null;
  name: string;
  qty: number;
  unit_price: number;
}

export interface SaleOrderInsert {
  fudo_order_id: number;
  channel: "fudo";
  status: BoardStatus;
  total: number;
  items_desc: string;
  delivery_address: string | null;
  notes: string | null;
  created_at: string;
  fudo_sale_type: FudoSaleType;
  fudo_sale_state: string;
  client_id: string | null;
  lines: OrderLineInsert[];
}

export interface SaleOrderUpdate {
  id: string;
  status: BoardStatus;
  fudo_sale_state: string;
}

export interface ExistingOrder {
  id: string;
  fudo_order_id: number;
  channel: string;
  status: string;
  fudo_sale_state: string | null;
  client_id?: string | null;
}

/** Pedidos ya importados sin cliente que ahora se pueden vincular, agrupados por cliente. */
export interface ClientRelink {
  client_id: string;
  orderIds: string[];
}

export interface SalesPlanInput {
  sales: FudoSale[];
  itemsBySale: ReadonlyMap<number, FudoItem[]>;
  productsByFudoId: ReadonlyMap<number, { id: string; name: string }>;
  existing: ExistingOrder[];
  clientsByFudoId: ReadonlyMap<number, string>;
  clientsByPhone: ReadonlyMap<string, string>;
}

export interface SalesPlan {
  inserts: SaleOrderInsert[];
  updates: SaleOrderUpdate[];
  relinks: ClientRelink[];
}

const NOTES_MAX = 300;

function clientFor(sale: FudoSale, input: SalesPlanInput): string | null {
  const key = phoneKey(sale.anon?.phone);
  return (
    (sale.customerId !== null ? input.clientsByFudoId.get(sale.customerId) : undefined) ??
    (key ? input.clientsByPhone.get(key) : undefined) ??
    null
  );
}

function linesFor(items: FudoItem[], products: SalesPlanInput["productsByFudoId"]): OrderLineInsert[] {
  return items
    .filter((i) => !i.canceled)
    .map((i) => {
      const product = i.productId === null ? undefined : products.get(i.productId);
      return {
        product_id: product?.id ?? null,
        name: product?.name ?? (i.productId === null ? "Producto de Fudo" : `Producto Fudo #${i.productId}`),
        qty: i.quantity,
        unit_price: i.price,
      };
    });
}

export function planSalesImport(input: SalesPlanInput): SalesPlan {
  const plan: SalesPlan = { inserts: [], updates: [], relinks: [] };
  const byFudoId = new Map(input.existing.map((o) => [o.fudo_order_id, o]));
  const relinks = new Map<string, string[]>();

  for (const sale of input.sales) {
    if (sale.saleType === "EAT-IN") continue;
    const target = mapSaleState(sale.saleState);
    const existing = byFudoId.get(sale.id);

    if (existing) {
      // Un pedido que la app envió a Fudo vuelve en el listado: su estado lo maneja la app, no se toca.
      if (existing.channel !== "fudo") continue;
      const status = nextStatus(existing.status as BoardStatus, target);
      if (status !== existing.status || sale.saleState !== existing.fudo_sale_state) {
        plan.updates.push({ id: existing.id, status, fudo_sale_state: sale.saleState });
      }
      // Solo se completa un cliente faltante; nunca se pisa uno ya asignado.
      const relinkTo = existing.client_id === null ? clientFor(sale, input) : null;
      if (relinkTo) relinks.set(relinkTo, [...(relinks.get(relinkTo) ?? []), existing.id]);
      continue;
    }

    const lines = linesFor(input.itemsBySale.get(sale.id) ?? [], input.productsByFudoId);
    const clientId = clientFor(sale, input);
    const notes = [sale.anon?.name ?? sale.customerName, sale.anon?.phone, sale.comment].filter(Boolean).join(" · ");

    plan.inserts.push({
      fudo_order_id: sale.id,
      channel: "fudo",
      status: target,
      total: sale.total,
      items_desc: lines.length ? lines.map((l) => `${l.qty}x ${l.name}`).join(" · ") : `Venta Fudo #${sale.id}`,
      delivery_address: sale.saleType === "DELIVERY" ? parseFudoAddress(sale.anon?.address) : null,
      notes: notes ? notes.slice(0, NOTES_MAX) : null,
      created_at: sale.createdAt,
      fudo_sale_type: sale.saleType,
      fudo_sale_state: sale.saleState,
      client_id: clientId,
      lines,
    });
  }
  return { ...plan, relinks: [...relinks].map(([client_id, orderIds]) => ({ client_id, orderIds })) };
}
