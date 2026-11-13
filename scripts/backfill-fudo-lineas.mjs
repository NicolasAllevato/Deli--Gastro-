// Re-deriva nombres y líneas de los pedidos de Fudo ya guardados con "Producto Fudo #<id>" (productos sin
// mapear, genéricos de PedidosYa/Rappi y opciones de combos). Lee cada venta de la API pública de Fudo
// (`GET /sales/{id}?include=items`) y el catálogo (`GET /products`, `GET /product-categories`).
//
//   node --env-file=.env.local scripts/backfill-fudo-lineas.mjs                  -> dry-run (por defecto): solo muestra qué cambiaría
//   node --env-file=.env.local scripts/backfill-fudo-lineas.mjs --aplicar        -> escribe items_desc y order_items
//   ... --limite=5                                                               -> prueba con pocos pedidos
//
// Idempotente: un pedido cuyo items_desc ya coincide con el derivado no se toca, y un pedido ya corregido no
// vuelve a aparecer (el filtro busca "Producto Fudo #"). Con --aplicar reemplaza las order_items del pedido.
// Si la migración 031 no está aplicada, escribe las líneas sin las columnas de Fudo y lo avisa.
// Env: NEXT_PUBLIC_SUPABASE_URL (o SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, FUDO_AUTH_URL,
//      FUDO_PUBLIC_API_URL, FUDO_API_KEY, FUDO_API_SECRET. No imprime secretos ni datos de clientes.

import { parseFudoCategories, parseFudoProducts } from "../workers/fudo-gateway/src/catalog.ts";
import { parseFudoItem, parseFudoSales } from "../workers/fudo-gateway/src/sales.ts";
import { buildCatalogIndex, buildSaleLines, saleItemsDesc } from "../workers/fudo-gateway/src/sale-lines.ts";

const PAGE = 1000;
const FUDO_COLS = ["fudo_product_id", "fudo_comment", "fudo_options"];

function parseArgs(argv) {
  const limitArg = argv.find((a) => a.startsWith("--limite="));
  const limit = limitArg ? Number(limitArg.slice("--limite=".length)) : null;
  if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) throw new Error("--limite tiene que ser un entero positivo.");
  return { apply: argv.includes("--aplicar"), limit };
}

function need(name) {
  const v = (process.env[name] ?? "").trim();
  if (!v) throw new Error(`Falta la variable de entorno ${name}.`);
  return v;
}

function createRest(url, key) {
  return async (path, init = {}) => {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", prefer: "return=minimal", ...init.headers },
    });
    if (!res.ok) throw new Error(`Supabase ${init.method ?? "GET"} ${path.split("?")[0]} → ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };
}

/** Cliente mínimo de la API pública de Fudo (fudo.ts usa sintaxis que node no puede ejecutar sin compilar). */
function createFudo(env) {
  let token = null;
  const auth = async () => {
    const res = await fetch(env.FUDO_AUTH_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: env.FUDO_API_KEY, apiSecret: env.FUDO_API_SECRET }),
    });
    if (!res.ok) throw new Error(`Fudo auth → ${res.status}`);
    token = (await res.json()).token;
    if (!token) throw new Error("Fudo auth no devolvió token");
  };
  const get = async (path) => {
    if (!token) await auth();
    const send = () => fetch(`${env.FUDO_PUBLIC_API_URL}/${path}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
    let res = await send();
    if (res.status === 401) {
      await auth();
      res = await send();
    }
    if (!res.ok) throw new Error(`Fudo ${path.split("?")[0]} → ${res.status}`);
    return res.json();
  };
  const list = async (resource) => {
    const data = [];
    for (let page = 1; page <= 60; page++) {
      const body = await get(`${resource}?page[size]=100&page[number]=${page}`);
      data.push(...body.data);
      if (body.data.length < 100) return { data };
    }
    throw new Error(`Fudo ${resource}: listado incompleto`);
  };
  return { get, list };
}

async function main() {
  const { apply, limit } = parseArgs(process.argv.slice(2));
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim().replace(/\/$/, "");
  if (!url) throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_URL.");
  const rest = createRest(url, need("SUPABASE_SERVICE_ROLE_KEY"));
  const env = {
    FUDO_AUTH_URL: need("FUDO_AUTH_URL"),
    FUDO_PUBLIC_API_URL: need("FUDO_PUBLIC_API_URL").replace(/\/$/, ""),
    FUDO_API_KEY: need("FUDO_API_KEY"),
    FUDO_API_SECRET: need("FUDO_API_SECRET"),
  };
  const fudo = createFudo(env);

  const orders = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await rest(
      `orders?channel=eq.fudo&fudo_order_id=not.is.null&items_desc=like.*${encodeURIComponent("Producto Fudo #")}*&select=id,fudo_order_id,items_desc&order=created_at.desc&limit=${PAGE}&offset=${offset}`,
    );
    orders.push(...rows);
    if (rows.length < PAGE) break;
  }
  const todo = limit ? orders.slice(0, limit) : orders;
  console.log(`Pedidos con "Producto Fudo #": ${orders.length}${limit ? ` (se procesan ${todo.length})` : ""}. Modo: ${apply ? "APLICAR" : "dry-run"}.`);
  if (todo.length === 0) return;

  const [products, categories, productMap] = await Promise.all([
    fudo.list("products"),
    fudo.list("product-categories"),
    rest("fudo_product_map?select=fudo_product_id,product_id,products(name)"),
  ]);
  const catalog = buildCatalogIndex(parseFudoProducts(products), parseFudoCategories(categories));
  const mapped = new Map(productMap.map((m) => [m.fudo_product_id, { id: m.product_id, name: m.products?.name ?? `Producto Fudo #${m.fudo_product_id}` }]));

  let hasFudoCols = true;
  try {
    await rest("order_items?select=fudo_product_id&limit=1");
  } catch {
    hasFudoCols = false;
    console.warn("Aviso: la migración 031 no está aplicada; las líneas se escriben sin fudo_product_id/fudo_comment/fudo_options.");
  }

  let changed = 0;
  let failed = 0;
  for (const order of todo) {
    try {
      const body = await fudo.get(`sales/${order.fudo_order_id}?include=items`);
      const [sale] = parseFudoSales({ data: [body.data] });
      if (!sale) throw new Error(`venta ${order.fudo_order_id} ilegible`);
      const byId = new Map((body.included ?? []).filter((e) => e?.type === "Item").map(parseFudoItem).filter(Boolean).map((i) => [i.id, i]));
      const items = sale.itemIds.map((id) => byId.get(id)).filter(Boolean);
      const lines = buildSaleLines(items, mapped, catalog);
      const desc = lines.length ? saleItemsDesc(lines) : order.items_desc;
      if (desc === order.items_desc) continue;
      changed++;
      console.log(`- venta ${order.fudo_order_id}: "${order.items_desc}" → "${desc}"`);
      if (!apply) continue;
      const rows = lines.map((l) => {
        const row = { ...l, order_id: order.id };
        if (!hasFudoCols) for (const c of FUDO_COLS) delete row[c];
        return row;
      });
      await rest(`order_items?order_id=eq.${order.id}`, { method: "DELETE" });
      if (rows.length) await rest("order_items", { method: "POST", body: JSON.stringify(rows) });
      // El filtro por items_desc viejo evita pisar un cambio hecho entre la lectura y la escritura.
      await rest(`orders?id=eq.${order.id}&channel=eq.fudo&items_desc=eq.${encodeURIComponent(order.items_desc)}`, {
        method: "PATCH",
        body: JSON.stringify({ items_desc: desc }),
      });
    } catch (e) {
      failed++;
      console.error(`- venta ${order.fudo_order_id}: error ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`Listo. ${apply ? "Corregidos" : "A corregir"}: ${changed}. Con error: ${failed}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
