import { parseFudoCustomers, planCustomersImport, type ExistingClient } from "./customers.ts";
import { rest, type DbEnv } from "./db";
import { listPublicResource, type FudoEnv } from "./fudo";
import { parseFudoItem, parseFudoSales, phoneKey, planSalesImport, type ExistingOrder, type FudoItem } from "./sales.ts";

/**
 * Importa ventas (delivery y take away) y clientes de Fudo a la app. Usa los planes puros de `sales.ts` y
 * `customers.ts`; acá solo hay lectura de Fudo y escritura en Supabase por PostgREST. Ambos aceptan `dryRun`.
 */

export interface SalesSyncSummary {
  salesSeen: number;
  ordersCreated: number;
  ordersUpdated: number;
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

export async function syncSales(env: FudoEnv & DbEnv, dryRun = false, windowHours = DEFAULT_SALES_WINDOW_HOURS): Promise<SalesSyncSummary> {
  try {
    const to = new Date();
    const from = new Date(to.getTime() - windowHours * 3_600_000);
    const range = `filter[createdAt]=and(gte.${fudoDate(from)},lte.${fudoDate(to)})&sort=-createdAt`;
    // Fudo solo acepta `filter[saleType]=eq.<TIPO>` (rechaza `in.(...)` con 400): una consulta por tipo.
    // `include=items` trae los ítems en la misma respuesta: leerlos uno por uno agota los subrequests del Worker.
    const sales = [];
    const itemsById = new Map<number, FudoItem>();
    for (const type of IMPORTED_SALE_TYPES) {
      const page = await listPublicResource(env, "sales", `${range}&filter[saleType]=eq.${type}&include=items`);
      sales.push(...parseFudoSales(page));
      for (const raw of page.included) {
        const item = parseFudoItem(raw);
        if (item) itemsById.set(item.id, item);
      }
    }
    if (sales.length === 0) return { salesSeen: 0, ordersCreated: 0, ordersUpdated: 0, dryRun };

    const existing: ExistingOrder[] = [];
    for (const ids of chunk(sales.map((s) => s.id), ID_BATCH)) {
      existing.push(...(await rest<ExistingOrder[]>(env, `orders?fudo_order_id=in.(${ids.join(",")})&select=id,fudo_order_id,channel,status,fudo_sale_state`)));
    }
    const known = new Set(existing.map((o) => o.fudo_order_id));

    const itemsBySale = new Map<number, FudoItem[]>();
    for (const sale of sales) {
      if (!known.has(sale.id)) itemsBySale.set(sale.id, sale.itemIds.map((id) => itemsById.get(id)).filter((i): i is FudoItem => i !== undefined));
    }

    const [productMap, clients] = await Promise.all([
      rest<Array<{ fudo_product_id: number; product_id: string; products: { name: string } | null }>>(
        env,
        "fudo_product_map?select=fudo_product_id,product_id,products(name)",
      ),
      rest<Array<{ id: string; phone: string | null; fudo_customer_id: number | null }>>(env, "clients?select=id,phone,fudo_customer_id"),
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
    });

    if (!dryRun) {
      for (const order of plan.inserts) {
        const { lines, ...row } = order;
        // ignore-duplicates: si dos corridas se pisan, la venta igual entra una sola vez (fudo_order_id único).
        const [created] = await rest<Array<{ id: string }>>(env, "orders?on_conflict=fudo_order_id&select=id", {
          method: "POST",
          headers: { prefer: "return=representation,resolution=ignore-duplicates" },
          body: JSON.stringify(row),
        });
        if (created && lines.length) {
          await rest(env, "order_items", {
            method: "POST",
            headers: { prefer: "return=minimal" },
            body: JSON.stringify(lines.map((l) => ({ ...l, order_id: created.id }))),
          });
        }
      }
      for (const u of plan.updates) {
        await rest(env, `orders?id=eq.${u.id}&channel=eq.fudo`, {
          method: "PATCH",
          headers: { prefer: "return=minimal" },
          body: JSON.stringify({ status: u.status, fudo_sale_state: u.fudo_sale_state }),
        });
      }
      if (plan.inserts.length || plan.updates.length) await logRun(env, "sales", plan.inserts.length, plan.updates.length, null);
    }
    return { salesSeen: sales.length, ordersCreated: plan.inserts.length, ordersUpdated: plan.updates.length, dryRun };
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
