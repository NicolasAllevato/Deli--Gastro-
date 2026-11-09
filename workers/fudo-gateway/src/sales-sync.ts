import { parseFudoCustomers, planCustomersImport, type ExistingClient } from "./customers.ts";
import { rest, type DbEnv } from "./db";
import { listPublicResource, type FudoEnv } from "./fudo";
import { parseFudoItem, parseFudoSales, parsePaymentMethods, parsePaymentRows, paymentMethodIds, phoneKey, planSalesImport, salePaymentLines, type ExistingOrder, type FudoItem, type SalesRange } from "./sales.ts";

/**
 * Importa ventas (delivery y take away) y clientes de Fudo a la app. Usa los planes puros de `sales.ts` y
 * `customers.ts`; acá solo hay lectura de Fudo y escritura en Supabase por PostgREST. Ambos aceptan `dryRun`.
 */

export interface SalesSyncSummary {
  salesSeen: number;
  ordersCreated: number;
  ordersUpdated: number;
  ordersRelinked?: number;
  ordersEnriched?: number;
  dryRun: boolean;
}

export interface CustomersSyncSummary {
  customersSeen: number;
  clientsCreated: number;
  clientsUpdated: number;
  dryRun: boolean;
}

/** Ventana de ventas que se revisa en cada corrida (las anteriores ya se importaron y no cambian más). */
export const DEFAULT_SALES_WINDOW_HOURS = 48;
/** Tope de actualizaciones de clientes por corrida: cada una es un PATCH (límite de subrequests del Worker). */
const MAX_CLIENT_UPDATES_PER_RUN = 300;
/** Tope de pedidos viejos a los que se les completa el detalle de pagos por corrida: cada uno es un PATCH. */
const MAX_PAYMENT_FILLS_PER_RUN = 10;
const ID_BATCH = 100;
const IMPORTED_SALE_TYPES = ["DELIVERY", "TAKEAWAY"] as const;

const fudoDate = (d: Date): string => d.toISOString().slice(0, 19);
const chunk = <T,>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
const MERGE_MIN = { prefer: "return=minimal,resolution=merge-duplicates" };

async function logRun(env: DbEnv, kind: "sales" | "customers", created: number, updated: number, error: string | null): Promise<void> {
  try {
    await rest(env, "fudo_sync_runs", {
      method: "POST",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ kind, ok: error === null, products_created: created, products_updated: updated, error: error?.slice(0, 500) ?? null }),
    });
  } catch {
    // La bitácora no cambia el resultado.
  }
}

export async function syncSales(env: FudoEnv & DbEnv, dryRun = false, window: SalesRange | null = null): Promise<SalesSyncSummary> {
  try {
    const to = window?.to ?? new Date();
    const from = window?.from ?? new Date(to.getTime() - DEFAULT_SALES_WINDOW_HOURS * 3_600_000);
    const range = `filter[createdAt]=and(gte.${fudoDate(from)},lte.${fudoDate(to)})&sort=-createdAt`;
    // Fudo solo acepta `filter[saleType]=eq.<TIPO>` (rechaza `in.(...)` con 400): una consulta por tipo.
    // `include=items` trae los ítems en la misma respuesta: leerlos uno por uno agota los subrequests del Worker.
    // `payments` da el medio de pago, del que sale el canal (PedidosYa, Rappi, Morfy o local).
    const sales = [];
    const itemsById = new Map<number, FudoItem>();
    const methodByPayment = new Map<number, number>();
    const paymentRows = new Map<number, ReturnType<typeof parsePaymentRows> extends Map<number, infer R> ? R : never>();
    for (const type of IMPORTED_SALE_TYPES) {
      const page = await listPublicResource(env, "sales", `${range}&filter[saleType]=eq.${type}&include=items,payments`);
      sales.push(...parseFudoSales(page));
      for (const raw of page.included) {
        if ((raw as { type?: unknown }).type !== "Item") continue;
        const item = parseFudoItem(raw);
        if (item) itemsById.set(item.id, item);
      }
      for (const [payment, method] of paymentMethodIds(page.included)) methodByPayment.set(payment, method);
      for (const [payment, row] of parsePaymentRows(page.included)) paymentRows.set(payment, row);
    }
    if (sales.length === 0) return { salesSeen: 0, ordersCreated: 0, ordersUpdated: 0, dryRun };

    const existing: ExistingOrder[] = [];
    for (const ids of chunk(sales.map((s) => s.id), ID_BATCH)) {
      existing.push(...(await rest<ExistingOrder[]>(env, `orders?fudo_order_id=in.(${ids.join(",")})&select=id,fudo_order_id,channel,status,fudo_sale_state,client_id,fudo_source,fudo_payments,total`)));
    }
    const known = new Set(existing.map((o) => o.fudo_order_id));

    const itemsBySale = new Map<number, FudoItem[]>();
    for (const sale of sales) {
      if (!known.has(sale.id)) itemsBySale.set(sale.id, sale.itemIds.map((id) => itemsById.get(id)).filter((i): i is FudoItem => i !== undefined));
    }

    const methodNames = parsePaymentMethods((await listPublicResource(env, "payment-methods")).data);
    const paymentNamesBySale = new Map(
      sales.map((s) => [s.id, s.paymentIds.map((p) => methodNames.get(methodByPayment.get(p) ?? -1)).filter((n): n is string => Boolean(n))]),
    );

    const paymentLinesBySale = new Map(sales.map((s) => [s.id, salePaymentLines(s.paymentIds, paymentRows, methodNames)]));

    const [productMap, clients] = await Promise.all([
      rest<Array<{ fudo_product_id: number; product_id: string; products: { name: string } | null }>>(
        env,
        "fudo_product_map?select=fudo_product_id,product_id,products(name)",
      ),
      rest<Array<{ id: string; phone: string | null; address: string | null; fudo_customer_id: number | null }>>(env, "clients?select=id,phone,address,fudo_customer_id"),
    ]);
    const clientsByPhone = new Map<string, string>();
    for (const c of clients) {
      const key = phoneKey(c.phone);
      if (key && !clientsByPhone.has(key)) clientsByPhone.set(key, c.id);
    }

    const plan = planSalesImport({
      sales,
      itemsBySale,
      productsByFudoId: new Map(productMap.map((m) => [m.fudo_product_id, { id: m.product_id, name: m.products?.name ?? `Producto Fudo #${m.fudo_product_id}` }])),
      existing,
      clientsByFudoId: new Map(clients.filter((c) => c.fudo_customer_id !== null).map((c) => [c.fudo_customer_id as number, c.id])),
      clientsByPhone,
      paymentNamesBySale,
      paymentLinesBySale,
      clientAddressById: new Map(clients.filter((c) => c.address).map((c) => [c.id, c.address as string])),
    });

    if (!dryRun) {
      // En lotes: un POST de pedidos y otro de ítems por lote, para no agotar los subrequests del Worker.
      for (const batch of chunk(plan.inserts, ID_BATCH)) {
        // ignore-duplicates: si dos corridas se pisan, la venta igual entra una sola vez (fudo_order_id único).
        // Solo vuelven las filas insertadas, así que los ítems se cuelgan solo de esas.
        const created = await rest<Array<{ id: string; fudo_order_id: number }>>(env, "orders?on_conflict=fudo_order_id&select=id,fudo_order_id", {
          method: "POST",
          headers: { prefer: "return=representation,resolution=ignore-duplicates" },
          body: JSON.stringify(batch.map(({ lines: _lines, ...row }) => row)),
        });
        const idByFudo = new Map(created.map((c) => [c.fudo_order_id, c.id]));
        const items = batch.flatMap((o) => {
          const orderId = idByFudo.get(o.fudo_order_id);
          return orderId ? o.lines.map((l) => ({ ...l, order_id: orderId })) : [];
        });
        if (items.length) {
          await rest(env, "order_items", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify(items) });
        }
      }
      for (const { id, ...patch } of plan.updates) {
        await rest(env, `orders?id=eq.${id}&channel=eq.fudo`, {
          method: "PATCH",
          headers: { prefer: "return=minimal" },
          body: JSON.stringify(patch),
        });
      }
      // Un PATCH por cliente (no por pedido); client_id=is.null para no pisar uno asignado entre tanto.
      for (const r of plan.relinks) {
        for (const ids of chunk(r.orderIds, ID_BATCH)) {
          await rest(env, `orders?id=in.(${ids.join(",")})&channel=eq.fudo&client_id=is.null`, {
            method: "PATCH",
            headers: { prefer: "return=minimal" },
            body: JSON.stringify({ client_id: r.client_id }),
          });
        }
      }
      // Agrupados por valores iguales: un PATCH por combinación canal/nombre/medio, no por pedido.
      const groups = new Map<string, { body: Omit<(typeof plan.enrich)[number], "id">; ids: string[] }>();
      for (const { id, ...body } of plan.enrich) {
        const key = JSON.stringify(body);
        groups.set(key, { body, ids: [...(groups.get(key)?.ids ?? []), id] });
      }
      for (const { body, ids: all } of groups.values()) {
        for (const ids of chunk(all, ID_BATCH)) {
          await rest(env, `orders?id=in.(${ids.join(",")})&channel=eq.fudo&fudo_source=is.null`, {
            method: "PATCH",
            headers: { prefer: "return=minimal" },
            body: JSON.stringify(body),
          });
        }
      }
      for (const { id, fudo_payments } of plan.paymentFills.slice(0, MAX_PAYMENT_FILLS_PER_RUN)) {
        await rest(env, `orders?id=eq.${id}&channel=eq.fudo&fudo_payments=is.null`, {
          method: "PATCH",
          headers: { prefer: "return=minimal" },
          body: JSON.stringify({ fudo_payments }),
        });
      }
      const relinked = plan.relinks.reduce((n, r) => n + r.orderIds.length, 0);
      if (plan.inserts.length || plan.updates.length || relinked) await logRun(env, "sales", plan.inserts.length, plan.updates.length + relinked, null);
    }
    const ordersRelinked = plan.relinks.reduce((n, r) => n + r.orderIds.length, 0);
    return { salesSeen: sales.length, ordersCreated: plan.inserts.length, ordersUpdated: plan.updates.length, ordersRelinked, ordersEnriched: plan.enrich.length, dryRun };
  } catch (e) {
    if (!dryRun) await logRun(env, "sales", 0, 0, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

export async function syncCustomers(env: FudoEnv & DbEnv, dryRun = false): Promise<CustomersSyncSummary> {
  try {
    const customers = parseFudoCustomers(await listPublicResource(env, "customers", "sort=name"));
    const existing = await rest<ExistingClient[]>(env, "clients?select=id,name,phone,email,address,fudo_customer_id");
    const plan = planCustomersImport({ customers, existing });
    const updates = plan.updates.slice(0, MAX_CLIENT_UPDATES_PER_RUN);

    if (!dryRun) {
      for (const rows of chunk(plan.inserts, ID_BATCH)) {
        await rest(env, "clients?on_conflict=fudo_customer_id", { method: "POST", headers: MERGE_MIN, body: JSON.stringify(rows) });
      }
      for (const { id, ...patch } of updates) {
        await rest(env, `clients?id=eq.${id}`, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify(patch) });
      }
      if (plan.inserts.length || updates.length) await logRun(env, "customers", plan.inserts.length, updates.length, null);
    }
    return { customersSeen: customers.length, clientsCreated: plan.inserts.length, clientsUpdated: updates.length, dryRun };
  } catch (e) {
    if (!dryRun) await logRun(env, "customers", 0, 0, e instanceof Error ? e.message : String(e));
    throw e;
  }
}
