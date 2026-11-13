/**
 * Ventas de Fudo -> pedidos de Deli-Gastro (`channel = 'fudo'`). Sin I/O: parseo de la API pública (JSON:API)
 * y plan de cambios. Solo se importan delivery y take away; el salón (EAT-IN) no es parte del tablero.
 * Reglas:
 *  - una venta se importa una sola vez (`orders.fudo_order_id` es único);
 *  - el estado solo avanza (nunca se retrocede lo que el admin movió en el tablero);
 *  - los pedidos que la app misma envió a Fudo no se tocan: su estado lo maneja la app.
 * Ver docs/FUDO_INTEGRACION.md.
 */

import { buildSaleLines, saleItemsDesc, type FudoCatalogIndex, type OrderLineInsert } from "./sale-lines.ts";

export type BoardStatus = "Recibidos" | "En Preparación" | "En Camino" | "Finalizados" | "Cancelado";
export type FudoSaleType = "DELIVERY" | "TAKEAWAY" | "EAT-IN";

export interface FudoSale {
  id: number;
  createdAt: string;
  /** Cierre informado por Fudo, si lo manda. */
  closedAt: string | null;
  total: number;
  saleType: FudoSaleType;
  saleState: string;
  customerId: number | null;
  anon: { name: string | null; phone: string | null; address: string | null } | null;
  customerName: string | null;
  comment: string | null;
  itemIds: number[];
  paymentIds: number[];
}

/** Canal de venta de un pedido de Fudo. Fudo no lo informa: se deduce del medio de pago. */
export type FudoSource = "pedidosya" | "rappi" | "morfy" | "local";

/** PedidosYa / Rappi / Morfy según el nombre del medio de pago (`Online Pedidos Ya`, `Efectivo Rappi`…); si no, local. */
export function fudoSourceFromMethods(names: readonly string[]): FudoSource {
  const all = names.join(" ").toLowerCase().replace(/\s+/g, "");
  if (all.includes("pedidosya") || all.includes("peya")) return "pedidosya";
  if (all.includes("rappi")) return "rappi";
  if (all.includes("morfy")) return "morfy";
  return "local";
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
      closedAt: str(a.closedAt),
      total: num(a.total),
      saleType,
      saleState: str(a.saleState) ?? "IN-COURSE",
      customerId: relId(e, "customer"),
      anon,
      customerName: str(a.customerName),
      comment: str(a.comment),
      itemIds: relIds(e, "items"),
      paymentIds: relIds(e, "payments"),
    });
  }
  return out;
}

/** `included` de Fudo: id de pago → id de medio de pago. */
export function paymentMethodIds(included: readonly unknown[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const e of included) {
    if (!isObject(e) || e.type !== "Payment") continue;
    const id = positiveInt(e.id);
    const method = relId(e, "paymentMethod");
    if (id !== null && method !== null) out.set(id, method);
  }
  return out;
}

export interface FudoPaymentLine {
  name: string;
  amount: number;
}

export interface FudoPaymentRow {
  methodId: number;
  amount: number;
  canceled: boolean;
}

/** `included` de Fudo: id de pago → medio, monto y si fue anulado. */
export function parsePaymentRows(included: readonly unknown[]): Map<number, FudoPaymentRow> {
  const out = new Map<number, FudoPaymentRow>();
  for (const e of included) {
    if (!isObject(e) || e.type !== "Payment" || !isObject(e.attributes)) continue;
    const id = positiveInt(e.id);
    const methodId = relId(e, "paymentMethod");
    if (id !== null && methodId !== null) out.set(id, { methodId, amount: num(e.attributes.amount), canceled: e.attributes.canceled === true });
  }
  return out;
}

/** Pagos de una venta por nombre de medio: suma los repetidos y descarta los anulados y los de medio desconocido. */
export function salePaymentLines(
  paymentIds: readonly number[],
  rows: ReadonlyMap<number, FudoPaymentRow>,
  methodNames: ReadonlyMap<number, string>,
): FudoPaymentLine[] {
  const byName = new Map<string, number>();
  for (const id of paymentIds) {
    const row = rows.get(id);
    const name = row && !row.canceled ? methodNames.get(row.methodId) : undefined;
    if (row && name) byName.set(name, (byName.get(name) ?? 0) + row.amount);
  }
  return [...byName].map(([name, amount]) => ({ name, amount }));
}

/** `GET /payment-methods`: id → nombre. */
export function parsePaymentMethods(list: readonly unknown[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const e of list) {
    if (!isObject(e) || !isObject(e.attributes)) continue;
    const id = positiveInt(e.id);
    const name = str(e.attributes.name);
    if (id !== null && name) out.set(id, name);
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

export type { OrderLineInsert } from "./sale-lines.ts";

export interface SaleOrderInsert {
  fudo_order_id: number;
  channel: "fudo";
  status: BoardStatus;
  total: number;
  items_desc: string;
  delivery_address: string | null;
  notes: string | null;
  created_at: string;
  delivered_at: string | null;
  fudo_sale_type: FudoSaleType;
  fudo_sale_state: string;
  client_id: string | null;
  customer_name: string | null;
  fudo_source: FudoSource;
  fudo_payment: string | null;
  fudo_payments: FudoPaymentLine[] | null;
  /** Solo si Fudo ya la marca "Enviado" y hay un único repartidor habilitado hoy. */
  courier_name?: string;
  lines: OrderLineInsert[];
}

export interface SaleOrderUpdate {
  id: string;
  status: BoardStatus;
  fudo_sale_state: string;
  /** Solo si cambió: una venta abierta puede sumar ítems después de importarse. */
  total?: number;
  /** Solo al detectar el cambio: la marca queda con la hora en que se vio, no se pisa después. */
  ready_at?: string;
  picked_up_at?: string;
  delivered_at?: string;
}

export interface ExistingOrder {
  id: string;
  fudo_order_id: number;
  channel: string;
  status: string;
  fudo_sale_state: string | null;
  client_id?: string | null;
  fudo_source?: string | null;
  fudo_payments?: unknown;
  total?: number | string | null;
  picked_up_at?: string | null;
  courier_name?: string | null;
}

/** Completa canal, nombre y medio de pago en pedidos importados antes de que existieran esas columnas. */
export interface SaleOrderEnrich {
  id: string;
  fudo_source: FudoSource;
  customer_name: string | null;
  fudo_payment: string | null;
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
  /** Catálogo de Fudo (nombres y categoría de opciones): para productos sin mapear, genéricos y opciones. */
  catalog?: FudoCatalogIndex;
  existing: ExistingOrder[];
  clientsByFudoId: ReadonlyMap<number, string>;
  clientsByPhone: ReadonlyMap<string, string>;
  /** Nombres de los medios de pago de cada venta (id de venta → nombres). */
  paymentNamesBySale?: ReadonlyMap<number, string[]>;
  /** Dirección guardada de cada cliente de la app: las ventas de clientes registrados no traen dirección propia. */
  clientAddressById?: ReadonlyMap<string, string>;
  /** Pagos de cada venta con su monto. */
  paymentLinesBySale?: ReadonlyMap<number, FudoPaymentLine[]>;
  /** Hora de esta corrida (ISO), para fechar los cambios de estado detectados. */
  now?: string;
  /** Único repartidor habilitado hoy (migración 029): recibe solo los deliveries que Fudo marca "Enviado". */
  soleCourier?: string | null;
  /**
   * Modo automático (`courier_assign_mode`): elige repartidor para cada delivery recién "Enviado". Tiene
   * prioridad sobre `soleCourier` y se llama solo cuando de verdad hay que asignar.
   */
  assignCourier?: () => string | null;
}

export interface SalesPlan {
  inserts: SaleOrderInsert[];
  updates: SaleOrderUpdate[];
  relinks: ClientRelink[];
  enrich: SaleOrderEnrich[];
  /** Pedidos ya importados a los que les falta el detalle de pagos. */
  paymentFills: Array<{ id: string; fudo_payments: FudoPaymentLine[] }>;
  /** Deliveries recién "Enviado" sin repartidor: se asignan solo si siguen sin uno (PATCH condicional). */
  autoAssign: Array<{ id: string; courier_name: string }>;
}

const NOTES_MAX = 300;

function saleMeta(sale: FudoSale, input: SalesPlanInput): Omit<SaleOrderEnrich, "id"> {
  const names = input.paymentNamesBySale?.get(sale.id) ?? [];
  const customer = sale.anon?.name ?? sale.customerName;
  return {
    fudo_source: fudoSourceFromMethods(names),
    customer_name: customer ? customer.slice(0, 120) : null,
    fudo_payment: names.length ? [...new Set(names)].join(" + ").slice(0, 80) : null,
  };
}

function clientFor(sale: FudoSale, input: SalesPlanInput): string | null {
  const key = phoneKey(sale.anon?.phone);
  return (
    (sale.customerId !== null ? input.clientsByFudoId.get(sale.customerId) : undefined) ??
    (key ? input.clientsByPhone.get(key) : undefined) ??
    null
  );
}


const READY_STATES: readonly string[] = ["READY-TO-DELIVER", "DELIVERY-SENT"];

/** Marcas de tiempo del cambio de estado recién detectado. */
function stageStamps(sale: FudoSale, existing: ExistingOrder, status: BoardStatus, now: string): Pick<SaleOrderUpdate, "ready_at" | "picked_up_at" | "delivered_at"> {
  const stamps: Pick<SaleOrderUpdate, "ready_at" | "picked_up_at" | "delivered_at"> = {};
  if (READY_STATES.includes(sale.saleState) && !READY_STATES.includes(existing.fudo_sale_state ?? "")) stamps.ready_at = now;
  // «Enviado» en Fudo es la salida. Si el repartidor ya la marcó en la app, esa es la buena.
  if (sale.saleState === "DELIVERY-SENT" && existing.fudo_sale_state !== "DELIVERY-SENT" && !existing.picked_up_at) stamps.picked_up_at = now;
  if (status === "Finalizados" && existing.status !== "Finalizados") stamps.delivered_at = sale.closedAt ?? now;
  return stamps;
}

/** Repartidor para un delivery que sale: el del modo automático o, si no, el único habilitado. */
function courierFor(input: SalesPlanInput): string | null {
  return input.assignCourier ? input.assignCourier() : input.soleCourier ?? null;
}

function withCourier(courier: string | null): { courier_name?: string } {
  return courier ? { courier_name: courier } : {};
}

export function planSalesImport(input: SalesPlanInput): SalesPlan {
  const now = input.now ?? new Date().toISOString();
  const plan: SalesPlan = { inserts: [], updates: [], relinks: [], enrich: [], paymentFills: [], autoAssign: [] };
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
      // Una venta anulada conserva el último total conocido. Sin dato previo no se compara.
      const totalChanged = sale.saleState !== "CANCELED" && existing.total != null && Math.abs(Number(existing.total) - sale.total) >= 0.01;
      if (status !== existing.status || sale.saleState !== existing.fudo_sale_state || totalChanged) {
        plan.updates.push({ id: existing.id, status, fudo_sale_state: sale.saleState, ...stageStamps(sale, existing, status, now), ...(totalChanged ? { total: sale.total } : {}) });
      }
      // La auto-asignación solo ocurre al detectar la transición a «Enviado»; no es retroactiva: si el
      // repartidor se habilita después de ese momento, el pedido ya enviado queda sin asignar (decisión de producto).
      const justSent = sale.saleType === "DELIVERY" && sale.saleState === "DELIVERY-SENT" && existing.fudo_sale_state !== "DELIVERY-SENT";
      if (justSent && !existing.courier_name && status === "En Camino") {
        const courier = courierFor(input);
        if (courier) plan.autoAssign.push({ id: existing.id, courier_name: courier });
      }
      // Solo se completa un cliente faltante; nunca se pisa uno ya asignado.
      const relinkTo = existing.client_id === null ? clientFor(sale, input) : null;
      if (relinkTo) relinks.set(relinkTo, [...(relinks.get(relinkTo) ?? []), existing.id]);
      // Pedidos importados antes de la migración 024: se completan canal, nombre y medio de pago una vez.
      if (existing.fudo_source === null && input.paymentNamesBySale) plan.enrich.push({ id: existing.id, ...saleMeta(sale, input) });
      const paymentLines = input.paymentLinesBySale?.get(sale.id);
      if (existing.fudo_payments === null && paymentLines?.length) plan.paymentFills.push({ id: existing.id, fudo_payments: paymentLines });
      continue;
    }

    const lines = buildSaleLines(input.itemsBySale.get(sale.id) ?? [], input.productsByFudoId, input.catalog);
    const clientId = clientFor(sale, input);
    const notes = [sale.anon?.name ?? sale.customerName, sale.anon?.phone, sale.comment].filter(Boolean).join(" · ");

    plan.inserts.push({
      fudo_order_id: sale.id,
      channel: "fudo",
      status: target,
      total: sale.total,
      items_desc: lines.length ? saleItemsDesc(lines) : `Venta Fudo #${sale.id}`,
      delivery_address: sale.saleType === "DELIVERY" ? parseFudoAddress(sale.anon?.address) ?? (clientId ? input.clientAddressById?.get(clientId) ?? null : null) : null,
      notes: notes ? notes.slice(0, NOTES_MAX) : null,
      created_at: sale.createdAt,
      // Una venta que ya llega cerrada solo tiene hora de cierre si Fudo la informa: no se inventa.
      delivered_at: target === "Finalizados" ? sale.closedAt : null,
      fudo_sale_type: sale.saleType,
      fudo_sale_state: sale.saleState,
      client_id: clientId,
      ...saleMeta(sale, input),
      // Sin pagos todavía (venta abierta) queda null, para completarlo cuando se cobre.
      fudo_payments: input.paymentLinesBySale?.get(sale.id)?.length ? input.paymentLinesBySale.get(sale.id) ?? null : null,
      ...withCourier(sale.saleType === "DELIVERY" && sale.saleState === "DELIVERY-SENT" ? courierFor(input) : null),
      lines,
    });
  }
  return { ...plan, relinks: [...relinks].map(([client_id, orderIds]) => ({ client_id, orderIds })) };
}
