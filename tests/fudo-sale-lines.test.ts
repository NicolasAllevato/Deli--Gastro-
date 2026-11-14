import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { buildSaleLines, saleItemsDesc, buildCatalogIndex, cleanComment, catalogToCache, catalogFromCache, resolveOptionProduct } = await import(
  "../workers/fudo-gateway/src/sale-lines.ts"
);
const { parseFudoSales, parseFudoItem, planSalesImport } = await import("../workers/fudo-gateway/src/sales.ts");
const { parseFudoProducts, parseFudoCategories } = await import("../workers/fudo-gateway/src/catalog.ts");
const { parseItems } = await import("../src/lib/orders.ts");
const { productSales, productSalesKey, buildComboRules } = await import("../src/lib/reports/product-sales.ts");

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
  item(4, 193, 0, null),
  item(5, 196, 0, null),
  item(6, 191, 0, null, 3),
  item(7, 199, 0, "Pizza muzzarella (8 porciones)"),
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
const cat = (id: number, name: string) => ({ id: String(id), attributes: { name } });
// Catálogo sin las empanadas sueltas: los gustos quedan con el nombre de Fudo (no hay producto real para normalizar).
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
      prod(219, "Pepsi Black (Lata)", 4, 2500),
      prod(300, "La Rabona", 11, 30000),
    ],
  }),
  parseFudoCategories({ data: [cat(9, "Opciones"), cat(10, "Productos Genéricos"), cat(3, "Empanadas"), cat(4, "Bebidas"), cat(11, "Promos")] }),
);
const items = ITEMS.map((i) => parseFudoItem(i)!);
const sale46635 = () => buildSaleLines(items, new Map(), CATALOG);
const ORDER_BASE = { status: "Finalizados", created_at: "2026-11-12T12:00:00Z" };
const NOV = { from: "2026-11-01", to: "2026-11-30" };

describe("líneas legibles de ventas de Fudo (venta 46635)", () => {
  it("el genérico toma el nombre del comentario y es combo; gustos y opcional genérico van dentro", () => {
    const lines = sale46635();
    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0], {
      product_id: null,
      name: "Combo para compartir",
      qty: 1,
      unit_price: 48600,
      fudo_product_id: 198,
      fudo_comment: "Combo para compartir -",
      is_combo: true,
      fudo_options: [
        { qty: 2, name: "Verduras", product_id: null, fudo_product_id: 195 },
        { qty: 1, name: "Cebolla y queso", product_id: null, fudo_product_id: 194 },
        { qty: 1, name: "Jamón y queso", product_id: null, fudo_product_id: 193 },
        { qty: 1, name: "Humita", product_id: null, fudo_product_id: 196 },
        { qty: 3, name: "Carne", product_id: null, fudo_product_id: 191 },
        { qty: 1, name: "Pizza muzzarella (8 porciones)", product_id: null, fudo_product_id: 199 },
      ],
    });
  });

  it("items_desc lleva lo de adentro entre paréntesis y parseItems lo vuelve a separar", () => {
    const desc = saleItemsDesc(sale46635());
    assert.equal(desc, "1x Combo para compartir (2x Verduras, 1x Cebolla y queso, 1x Jamón y queso, 1x Humita, 3x Carne, 1x Pizza muzzarella (8 porciones))");
    const [combo] = parseItems(desc);
    assert.equal(combo!.name, "Combo para compartir");
    assert.equal(combo!.options!.length, 6);
    assert.equal(combo!.options!.at(-1)!.name, "Pizza muzzarella (8 porciones)");
  });

  it("contabilización: Combos 1x Combo para compartir; Productos con gustos y pizza, a $0", () => {
    const lines = sale46635();
    const expectProducts = [
      ["Carne", 3], ["Verduras", 2], ["Cebolla y queso", 1], ["Humita", 1], ["Jamón y queso", 1], ["Pizza muzzarella (8 porciones)", 1],
    ];
    // Con líneas guardadas (order_items) el monto sale de la línea; solo con items_desc, del precio actual.
    const withLines = productSales([{ ...ORDER_BASE, items_desc: saleItemsDesc(lines), order_items: lines }], NOV, new Map(), 20);
    const textOnly = productSales([{ ...ORDER_BASE, items_desc: saleItemsDesc(lines) }], NOV, new Map([["Combo para compartir", 48600]]), 20);
    for (const sales of [withLines, textOnly]) {
      assert.deepEqual(sales.combos, [{ name: "Combo para compartir", units: 1, revenue: 48600 }]);
      assert.deepEqual(sales.products.map((r) => [r.name, r.units]), expectProducts);
      assert.ok(sales.products.every((r) => r.revenue === 0));
    }
  });

  it("los productos de un combo se multiplican por la cantidad de combos", () => {
    const two = sale46635().map((l) => ({ ...l, qty: 2 }));
    const sales = productSales([{ ...ORDER_BASE, items_desc: "", order_items: two }], NOV, new Map(), 20);
    assert.deepEqual(sales.combos, [{ name: "Combo para compartir", units: 2, revenue: 97200 }]);
    assert.equal(sales.products.find((r) => r.name === "Carne")!.units, 6);
  });

  it("los pedidos cancelados no cuentan", () => {
    const sales = productSales([{ ...ORDER_BASE, status: "Cancelado", items_desc: saleItemsDesc(sale46635()) }], NOV, new Map(), 20);
    assert.deepEqual(sales, { combos: [], products: [] });
  });

  it("producto de categoría promo en Fudo es combo aunque no traiga opciones", () => {
    const [line] = buildSaleLines([parseFudoItem(item(30, 300, 30000, null))!], new Map(), CATALOG);
    assert.equal(line!.is_combo, true);
  });

  it("producto de la app de categoría combo/promo va a Combos (pedido viejo sin líneas)", () => {
    const rules = buildComboRules([
      { id: "u-previa", name: "La previa (Gde Muzza + 2 latas cerveza)", category: "Combos" },
      { id: "u-pizza", name: "Muzzarella", category: "Pizzas" },
    ]);
    const sales = productSales(
      [{ ...ORDER_BASE, items_desc: "1x La previa (Gde Muzza + 2 latas cerveza) · 2x Muzzarella" }],
      NOV,
      new Map([["Muzzarella", 9000], ["La previa (Gde Muzza + 2 latas cerveza)", 15000]]),
      10,
      rules,
    );
    assert.deepEqual(sales.combos.map((r) => [r.name, r.units]), [["La previa (Gde Muzza + 2 latas cerveza)", 1]]);
    assert.deepEqual(sales.products, [{ name: "Muzzarella", units: 2, revenue: 18000 }]);
  });

  it("normaliza el gusto con el producto real cuando hay un único candidato", () => {
    const withEmpanadas = buildCatalogIndex(
      parseFudoProducts({
        data: [
          prod(198, "Producto Genérico", 10),
          prod(191, "Carne", 9),
          prod(194, "Cebolla y queso", 9),
          prod(201, "Empanada de carne", 3, 1900),
          prod(202, "Empanada de carne picante", 3, 1900),
          prod(213, "Empanada de queso y cebolla", 3, 1900),
        ],
      }),
      parseFudoCategories({ data: [cat(9, "Opciones"), cat(3, "Empanadas"), cat(10, "Productos Genéricos")] }),
    );
    assert.deepEqual(resolveOptionProduct("Carne", withEmpanadas), { id: 201, name: "Empanada de carne" });
    assert.deepEqual(resolveOptionProduct("Cebolla y queso", withEmpanadas), { id: 213, name: "Empanada de queso y cebolla" });
    assert.equal(resolveOptionProduct("Humita", withEmpanadas), null);
    // Si el producto real está mapeado a la app, el gusto queda con ese product_id y nombre.
    const lines = buildSaleLines(
      [parseFudoItem(item(1, 198, 48600, "Combo"))!, parseFudoItem(item(2, 191, 0, null, 3))!],
      new Map([[201, { id: "u-emp-carne", name: "Empanada de Carne" }]]),
      withEmpanadas,
    );
    assert.deepEqual(lines[0]!.fudo_options, [{ qty: 3, name: "Empanada de Carne", product_id: "u-emp-carne", fudo_product_id: 201 }]);
    // Y en Productos suma junto con las empanadas de carne vendidas sueltas.
    const sales = productSales(
      [{ ...ORDER_BASE, items_desc: "", order_items: [...lines, { product_id: "u-emp-carne", name: "Empanada de Carne", qty: 2, unit_price: 1900 }] }],
      NOV,
      new Map(),
      10,
    );
    assert.deepEqual(sales.products, [{ name: "Empanada de Carne", units: 5, revenue: 3800 }]);
  });

  it("producto sin mapear usa el nombre del catálogo de Fudo; mapeado usa el de la app", () => {
    const raw = [item(20, 213, 1900, null, 3), item(21, 219, 2500, null)].map((i) => parseFudoItem(i)!);
    const catalog = { ...CATALOG, products: new Map([...CATALOG.products, [213, { name: "Empanada de queso y cebolla", categoryId: 3 }]]) };
    const lines = buildSaleLines(raw, new Map([[219, { id: "uuid-pepsi", name: "Pepsi Black lata" }]]), catalog);
    assert.deepEqual(lines.map((l) => [l.qty, l.name, l.product_id, l.fudo_product_id, l.is_combo]), [
      [3, "Empanada de queso y cebolla", null, 213, false],
      [1, "Pepsi Black lata", "uuid-pepsi", 219, false],
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
    assert.equal(plan.inserts[0]!.lines[0]!.is_combo, true);
  });

  it("cleanComment quita separadores sueltos", () => {
    assert.equal(cleanComment("Combo para compartir - "), "Combo para compartir");
    assert.equal(cleanComment("  -  "), null);
  });

  it("el catálogo sobrevive la ida y vuelta por KV", () => {
    const back = catalogFromCache(JSON.parse(JSON.stringify(catalogToCache(CATALOG))))!;
    assert.equal(back.products.get(195)?.name, "Verduras");
    assert.ok(back.optionCategoryIds.has(9));
    assert.ok(back.comboCategoryIds.has(11));
    assert.equal(catalogFromCache("basura"), null);
  });
});

describe("regla de combos y promos (nombre o categoría con combo/promo y precio > 0)", () => {
  const PROMOS = buildCatalogIndex(
    parseFudoProducts({
      data: [
        prod(400, "La Rabona (Gde Muzza + 6 empanadas)", 20, 32000),
        prod(401, "COMBO PIZZAS X 2", 21, 28000),
        prod(402, "EMPANADA CARNE PROMO LIBRE", 20, 0),
        prod(403, "Michelob Promo ($0)", 20, 0),
        prod(404, "Jugo De Naranja (Adicional Promo)", 22, 2500),
        prod(201, "Empanada de carne", 3, 1900),
        prod(202, "Empanada de carne picante", 3, 1900),
      ],
    }),
    parseFudoCategories({ data: [cat(20, "Promos"), cat(21, "Platos Principales"), cat(22, "Cafetería"), cat(3, "Empanadas")] }),
  );
  const line = (productId: number, price: number, qty = 1) =>
    buildSaleLines([parseFudoItem(item(1, productId, price, null, qty))!], new Map([[201, { id: "u-emp-carne", name: "Empanada de Carne" }]]), PROMOS)[0]!;

  it("'COMBO PIZZAS X 2' a precio > 0 es combo aunque su categoría no sea de promos", () => {
    assert.equal(line(401, 28000).is_combo, true);
  });

  it("'La Rabona…' en la categoría Promos es combo", () => {
    const l = line(400, 32000);
    assert.equal(l.is_combo, true);
    assert.equal(l.name, "La Rabona (Gde Muzza + 6 empanadas)");
  });

  it("'EMPANADA CARNE PROMO LIBRE' a $0 es el producto Empanada de carne, no combo", () => {
    const l = line(402, 0, 2);
    assert.deepEqual([l.is_combo, l.name, l.product_id, l.fudo_product_id], [false, "Empanada de Carne", "u-emp-carne", 402]);
    const sales = productSales([{ ...ORDER_BASE, items_desc: "", order_items: [l] }], NOV, new Map(), 10);
    assert.deepEqual(sales, { combos: [], products: [{ name: "Empanada de Carne", units: 2, revenue: 0 }] });
  });

  it("'Michelob Promo ($0)' es producto (nombre limpio), no combo", () => {
    const l = line(403, 0);
    assert.deepEqual([l.is_combo, l.name], [false, "Michelob"]);
  });

  it("'(Adicional Promo)' es un producto normal con su monto", () => {
    const l = line(404, 2500);
    assert.equal(l.is_combo, false);
    const sales = productSales([{ ...ORDER_BASE, items_desc: "", order_items: [l] }], NOV, new Map(), 10);
    assert.deepEqual(sales.products, [{ name: "Jugo De Naranja (Adicional Promo)", units: 1, revenue: 2500 }]);
  });

  it("en los informes, una promo de la app a $0 en el texto es componente con el nombre limpio", () => {
    const sales = productSales(
      [{ ...ORDER_BASE, items_desc: "1x COMBO PIZZAS X 2 · 2x EMPANADA CARNE PROMO LIBRE" }],
      NOV,
      new Map([["COMBO PIZZAS X 2", 28000]]),
      10,
    );
    assert.deepEqual(sales.combos, [{ name: "COMBO PIZZAS X 2", units: 1, revenue: 28000 }]);
    assert.deepEqual(sales.products, [{ name: "EMPANADA CARNE", units: 2, revenue: 0 }]);
  });
});

describe("parseItems y claves de agrupación", () => {
  it("parseItems separa las opciones pero deja '(8 porciones)' en el nombre", () => {
    const [combo, pizza] = parseItems("1x Combo para compartir (2x Verduras, 1x Pollo) · 1x Pizza muzzarella (8 porciones)");
    assert.equal(combo!.name, "Combo para compartir");
    assert.deepEqual(combo!.options, [{ qty: 2, name: "Verduras" }, { qty: 1, name: "Pollo" }]);
    assert.equal(pizza!.name, "Pizza muzzarella (8 porciones)");
    assert.equal(pizza!.options, undefined);
  });

  it("productSalesKey: product_id, si no fudo_product_id + nombre, si no nombre", () => {
    assert.equal(productSalesKey({ product_id: "u1", fudo_product_id: 5, name: "X" }), "p:u1");
    assert.equal(productSalesKey({ product_id: null, fudo_product_id: 198, name: "Combo" }), "f:198:combo");
    assert.equal(productSalesKey({ product_id: null, name: "Combo" }), "n:combo");
  });
});
