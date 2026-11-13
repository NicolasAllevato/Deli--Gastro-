import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { buildSaleLines, saleItemsDesc, buildCatalogIndex, cleanComment, catalogToCache, catalogFromCache } = await import(
  "../workers/fudo-gateway/src/sale-lines.ts"
);
const { parseFudoSales, parseFudoItem, planSalesImport } = await import("../workers/fudo-gateway/src/sales.ts");
const { parseFudoProducts, parseFudoCategories } = await import("../workers/fudo-gateway/src/catalog.ts");
const { parseItems } = await import("../src/lib/orders.ts");
const { topProducts, productSalesKey } = await import("../src/lib/reports/analytics.ts");

// Venta 46635 (PedidosYa) tal como la devuelve la API pública con include=items.
const item = (id: number, productId: number, price: number, comment: string | null, quantity = 1) => ({
  type: "Item",
  id: String(id),
  attributes: { quantity, price, canceled: false, comment },
  relationships: { product: { data: { id: String(productId), type: "Product" } } },
});
const ITEMS = [
  item(1, 198, 48600, "Combo para compartir - "),
  item(2, 195, 0, null, 2),
  item(3, 194, 0, null),
  item(4, 191, 0, null),
  item(5, 192, 0, null),
  item(6, 193, 0, null),
  item(7, 196, 0, null),
  item(8, 197, 0, null),
  item(9, 199, 0, "Pizza muzzarella (8 porciones)"),
];
const SALE = {
  data: [
    {
      type: "Sale",
      id: "46635",
      attributes: { createdAt: "2026-11-12T22:10:00Z", total: 48600, saleType: "DELIVERY", saleState: "CLOSED", customerName: null, comment: null },
      relationships: { customer: { data: null }, items: { data: ITEMS.map((i) => ({ id: i.id, type: "Item" })) } },
    },
  ],
};
const prod = (id: number, name: string, cat: number, price = 0) => ({
  type: "Product",
  id: String(id),
  attributes: { name, price, active: true },
  relationships: { productCategory: { data: { id: String(cat), type: "ProductCategory" } } },
});
const CATALOG = buildCatalogIndex(
  parseFudoProducts({
    data: [
      prod(198, "Producto Genérico", 10),
      prod(199, "Opcional Genérico", 9),
      prod(191, "Carne", 9),
      prod(192, "Carne picante", 9),
      prod(193, "Jamón y queso", 9),
      prod(194, "Cebolla y queso", 9),
      prod(195, "Verduras", 9),
      prod(196, "Humita", 9),
      prod(197, "Pollo", 9),
      prod(213, "Empanada de queso y cebolla", 3, 1900),
      prod(219, "Pepsi Black (Lata)", 4, 2500),
    ],
  }),
  parseFudoCategories({ data: [{ id: "9", attributes: { name: "Opciones" } }, { id: "10", attributes: { name: "Productos Genéricos" } }, { id: "3", attributes: { name: "Empanadas" } }] }),
);
const items = ITEMS.map((i) => parseFudoItem(i)!);

describe("líneas legibles de ventas de Fudo (venta 46635)", () => {
  it("el genérico toma el nombre del comentario y las opciones a precio 0 se cuelgan del ítem anterior", () => {
    const lines = buildSaleLines(items, new Map(), CATALOG);
    assert.equal(lines.length, 2);
    assert.deepEqual(lines[0], {
      product_id: null,
      name: "Combo para compartir",
      qty: 1,
      unit_price: 48600,
      fudo_product_id: 198,
      fudo_comment: "Combo para compartir -",
      fudo_options: [
        { qty: 2, name: "Verduras" },
        { qty: 1, name: "Cebolla y queso" },
        { qty: 1, name: "Carne" },
        { qty: 1, name: "Carne picante" },
        { qty: 1, name: "Jamón y queso" },
        { qty: 1, name: "Humita" },
        { qty: 1, name: "Pollo" },
      ],
    });
    assert.equal(lines[1]!.name, "Pizza muzzarella (8 porciones)");
    assert.equal(lines[1]!.fudo_product_id, 199);
    assert.equal(lines[1]!.fudo_options, null);
  });

  it("arma items_desc con las opciones entre paréntesis", () => {
    assert.equal(
      saleItemsDesc(buildSaleLines(items, new Map(), CATALOG)),
      "1x Combo para compartir (2x Verduras, 1x Cebolla y queso, 1x Carne, 1x Carne picante, 1x Jamón y queso, 1x Humita, 1x Pollo) · 1x Pizza muzzarella (8 porciones)",
    );
  });

  it("producto sin mapear usa el nombre del catálogo de Fudo; mapeado usa el de la app", () => {
    const raw = [item(20, 213, 1900, null, 3), item(21, 219, 2500, null)].map((i) => parseFudoItem(i)!);
    const lines = buildSaleLines(raw, new Map([[219, { id: "uuid-pepsi", name: "Pepsi Black lata" }]]), CATALOG);
    assert.deepEqual(lines.map((l) => [l.qty, l.name, l.product_id, l.fudo_product_id]), [
      [3, "Empanada de queso y cebolla", null, 213],
      [1, "Pepsi Black lata", "uuid-pepsi", 219],
    ]);
  });

  it("sin catálogo (Fudo caído) cae al comentario o a 'Producto Fudo #id'", () => {
    const lines = buildSaleLines(items.slice(0, 2), new Map());
    assert.deepEqual(lines.map((l) => l.name), ["Combo para compartir", "Producto Fudo #195"]);
  });

  it("planSalesImport usa el catálogo para la venta nueva", () => {
    const [sale] = parseFudoSales(SALE);
    const plan = planSalesImport({
      sales: [sale],
      itemsBySale: new Map([[46635, items]]),
      productsByFudoId: new Map(),
      catalog: CATALOG,
      existing: [],
      clientsByFudoId: new Map(),
      clientsByPhone: new Map(),
    });
    assert.ok(!plan.inserts[0]!.items_desc.includes("Producto Fudo #"));
    assert.equal(plan.inserts[0]!.lines[0]!.fudo_product_id, 198);
  });

  it("cleanComment quita separadores sueltos", () => {
    assert.equal(cleanComment("Combo para compartir - "), "Combo para compartir");
    assert.equal(cleanComment("  -  "), null);
  });

  it("el catálogo sobrevive la ida y vuelta por KV", () => {
    const back = catalogFromCache(JSON.parse(JSON.stringify(catalogToCache(CATALOG))))!;
    assert.equal(back.products.get(195)?.name, "Verduras");
    assert.ok(back.optionCategoryIds.has(9));
    assert.equal(catalogFromCache("basura"), null);
  });
});

describe("contabilización por producto", () => {
  it("parseItems separa las opciones pero deja '(8 porciones)' en el nombre", () => {
    const [combo, pizza] = parseItems("1x Combo para compartir (2x Verduras, 1x Pollo) · 1x Pizza muzzarella (8 porciones)");
    assert.equal(combo!.name, "Combo para compartir");
    assert.deepEqual(combo!.options, [{ qty: 2, name: "Verduras" }, { qty: 1, name: "Pollo" }]);
    assert.equal(pizza!.name, "Pizza muzzarella (8 porciones)");
    assert.equal(pizza!.options, undefined);
  });

  it("productSalesKey: product_id, si no fudo_product_id + nombre, si no nombre", () => {
    assert.equal(productSalesKey({ product_id: "u1", fudo_product_id: 5, name: "X", qty: 1 }), "p:u1");
    assert.equal(productSalesKey({ product_id: null, fudo_product_id: 198, name: "Combo", qty: 1 }), "f:198:combo");
    assert.equal(productSalesKey({ product_id: null, name: "Combo", qty: 1 }), "n:combo");
  });

  it("topProducts cuenta los genéricos por nombre y no cuenta las opciones como productos", () => {
    const base = { client_id: null, status: "Finalizados", total: 0, delivery_fee: 0, channel: "fudo", payment_method: null, accepted_at: null, ready_at: null, picked_up_at: null, delivered_at: null, created_at: "2026-11-12T12:00:00Z" };
    const orders = [
      { ...base, id: "a", items_desc: "1x Combo para compartir (2x Verduras, 1x Pollo) · 1x Pizza muzzarella (8 porciones)" },
      { ...base, id: "b", items_desc: "x", order_items: [{ product_id: null, name: "Combo para compartir", qty: 2 }] },
    ];
    const top = topProducts(orders, { from: "2026-11-01", to: "2026-11-30" }, new Map(), 10);
    assert.deepEqual(top.map((t) => [t.name, t.units]), [["Combo para compartir", 3], ["Pizza muzzarella (8 porciones)", 1]]);
  });
});
