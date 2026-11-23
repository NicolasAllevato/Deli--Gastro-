import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { parseFudoProducts, parseFudoCategories, parseFudoModifierGroups, parseFudoModifiers, planModifierSync, planCatalogSync } = await import("../workers/fudo-gateway/src/catalog.ts");

describe("parseFudoProducts", () => {
  it("lee la forma plana { products: [...] }", () => {
    const out = parseFudoProducts({ products: [{ id: 7, name: " Muzza ", price: 9500, active: true, productCategoryId: 3 }] });
    assert.deepEqual(out, [{ id: 7, name: "Muzza", price: 9500, active: true, categoryId: 3, sellAlone: null, modifierGroupIds: [] }]);
  });

  it("lee la forma JSON:API con atributos y relaciones", () => {
    const out = parseFudoProducts({
      data: [{ id: "12", attributes: { name: "Fugazzeta", price: "11000.50", active: false, sellAlone: true }, relationships: { productCategory: { data: { id: "4" } } } }],
    });
    assert.deepEqual(out, [{ id: 12, name: "Fugazzeta", price: 11000.5, active: false, categoryId: 4, sellAlone: true, modifierGroupIds: [] }]);
  });

  it("tolera precio ausente o inválido (price null) y descarta entradas sin id o nombre", () => {
    const out = parseFudoProducts([{ id: 1, name: "A" }, { id: 2, name: "B", price: -5 }, { id: "x", name: "C" }, { id: 3, name: "  " }, null]);
    assert.deepEqual(out.map((p) => [p.id, p.price]), [[1, null], [2, null]]);
  });

  it("devuelve vacío ante un cuerpo desconocido", () => {
    assert.deepEqual(parseFudoProducts({ foo: 1 }), []);
    assert.deepEqual(parseFudoProducts(null), []);
  });
});

describe("parseFudoCategories", () => {
  it("lee categorías planas y JSON:API", () => {
    assert.deepEqual(parseFudoCategories({ productCategories: [{ id: 3, name: "Pizzas" }] }), [{ id: 3, name: "Pizzas" }]);
    assert.deepEqual(parseFudoCategories({ data: [{ id: "4", attributes: { name: "Bebidas" } }] }), [{ id: 4, name: "Bebidas" }]);
  });
});

const cat = (id: string, name: string, fudo_id: number | null = null) => ({ id, name, fudo_id });
const prod = (id: string, name: string, fudo_id: number | null = null, extra = {}) => ({
  id, name, fudo_id, price: 100, is_active: true, category_id: null as string | null, ...extra,
});

describe("planCatalogSync", () => {
  it("vincula por nombre un producto manual existente en vez de duplicarlo", () => {
    const plan = planCatalogSync({
      fudoCategories: [],
      fudoProducts: [{ id: 7, name: "muzza", price: 9500, active: true, categoryId: null }],
      categories: [],
      products: [prod("p1", "Muzza")],
    });
    assert.equal(plan.productInserts.length, 0);
    assert.deepEqual(plan.productUpdates, [{ id: "p1", name: "muzza", price: 9500, is_active: true, fudo_id: 7, category_fudo_id: null }]);
  });

  it("crea categorías y productos nuevos con precio", () => {
    const plan = planCatalogSync({
      fudoCategories: [{ id: 3, name: "Pizzas" }],
      fudoProducts: [{ id: 7, name: "Napo", price: 8000, active: true, categoryId: 3 }],
      categories: [],
      products: [],
    });
    assert.deepEqual(plan.categoryInserts, [{ name: "Pizzas", fudo_id: 3 }]);
    assert.deepEqual(plan.productInserts, [{ name: "Napo", price: 8000, is_active: true, fudo_id: 7, category_fudo_id: 3 }]);
  });

  it("no crea productos nuevos sin precio, con precio 0 ni inactivos (ruido del catálogo de Fudo)", () => {
    const plan = planCatalogSync({
      fudoCategories: [],
      fudoProducts: [
        { id: 1, name: "Sin precio", price: null, active: true, categoryId: null },
        { id: 2, name: "Gratis", price: 0, active: true, categoryId: null },
        { id: 3, name: "Apagado", price: 100, active: false, categoryId: null },
      ],
      categories: [],
      products: [],
    });
    assert.equal(plan.productInserts.length, 0);
  });

  it("no sincroniza lo que Fudo marca como no vendible solo (opciones y modificadores)", () => {
    const plan = planCatalogSync({
      fudoCategories: [],
      fudoProducts: [
        { id: 1, name: "Extra queso", price: 500, active: true, categoryId: null, sellAlone: false },
        { id: 2, name: "Muzza", price: 9500, active: true, categoryId: null, sellAlone: true },
        { id: 3, name: "Sin dato", price: 700, active: true, categoryId: null, sellAlone: null },
      ],
      categories: [],
      products: [],
    });
    assert.deepEqual(plan.productInserts.map((p) => p.name), ["Muzza", "Sin dato"]);
  });

  it("excluye las categorías genéricas de Fudo (opciones, modificadores) y sus productos", () => {
    const plan = planCatalogSync({
      fudoCategories: [{ id: 1, name: "Pizzas" }, { id: 2, name: "Opciones" }, { id: 3, name: "Modificadores genéricos" }, { id: 4, name: "Productos genéricos" }],
      fudoProducts: [
        { id: 10, name: "Muzza", price: 9500, active: true, categoryId: 1 },
        { id: 11, name: "Sabor", price: 100, active: true, categoryId: 2 },
        { id: 12, name: "Cosa", price: 100, active: true, categoryId: 4 },
      ],
      categories: [],
      products: [],
    });
    assert.deepEqual(plan.categoryInserts, [{ name: "Pizzas", fudo_id: 1 }]);
    assert.deepEqual(plan.productInserts.map((p) => p.name), ["Muzza"]);
  });

  it("un producto ya vinculado que Fudo apaga se actualiza a inactivo (no se ignora por ser inactivo)", () => {
    const plan = planCatalogSync({
      fudoCategories: [],
      fudoProducts: [{ id: 7, name: "Muzza", price: 9500, active: false, categoryId: null }],
      categories: [],
      products: [prod("p1", "Muzza", 7, { price: 9500 })],
    });
    assert.equal(plan.productUpdates.length, 1);
    assert.equal(plan.productUpdates[0].is_active, false);
  });

  it("Fudo manda: cambia el precio y la disponibilidad de un producto ya vinculado", () => {
    const plan = planCatalogSync({
      fudoCategories: [],
      fudoProducts: [{ id: 7, name: "Muzza", price: 10000, active: false, categoryId: null }],
      categories: [],
      products: [prod("p1", "Muzza", 7, { price: 9500 })],
    });
    assert.deepEqual(plan.productUpdates, [{ id: "p1", name: "Muzza", price: 10000, is_active: false, fudo_id: 7, category_fudo_id: null }]);
  });

  it("no genera cambios si todo coincide (idempotente)", () => {
    const plan = planCatalogSync({
      fudoCategories: [{ id: 3, name: "Pizzas" }],
      fudoProducts: [{ id: 7, name: "Muzza", price: 9500, active: true, categoryId: 3 }],
      categories: [cat("c1", "Pizzas", 3)],
      products: [prod("p1", "Muzza", 7, { price: 9500, category_id: "c1" })],
    });
    assert.equal(plan.categoryInserts.length + plan.categoryUpdates.length, 0);
    assert.equal(plan.productInserts.length + plan.productUpdates.length + plan.deactivate.length, 0);
  });

  it("desactiva los productos vinculados que ya no están en Fudo, pero deja los manuales", () => {
    const plan = planCatalogSync({
      fudoCategories: [],
      fudoProducts: [{ id: 7, name: "Muzza", price: 9500, active: true, categoryId: null }],
      categories: [],
      products: [prod("p1", "Muzza", 7, { price: 9500 }), prod("p2", "Vieja", 99), prod("p3", "Propia", null)],
    });
    assert.deepEqual(plan.deactivate, ["p2"]);
  });

  it("con catálogo vacío no desactiva nada (protege contra una respuesta rota)", () => {
    const plan = planCatalogSync({ fudoCategories: [], fudoProducts: [], categories: [], products: [prod("p2", "Vieja", 99)] });
    assert.deepEqual(plan.deactivate, []);
  });

  it("no pisa el id de Fudo ya vinculado cuando hay dos productos con el mismo nombre", () => {
    const plan = planCatalogSync({
      fudoCategories: [],
      fudoProducts: [{ id: 8, name: "Muzza", price: 1, active: true, categoryId: null }],
      categories: [],
      products: [prod("p1", "Muzza", 7)],
    });
    assert.equal(plan.productInserts.length, 1);
    assert.deepEqual(plan.deactivate, ["p1"]);
  });

  it("guardarraíl: si el listado cubre menos de la mitad de los vinculados no desactiva nada y lo avisa", () => {
    const products = Array.from({ length: 10 }, (_, i) => prod(`p${i}`, `Plato ${i}`, 100 + i, { price: 1 }));
    const plan = planCatalogSync({
      fudoCategories: [],
      fudoProducts: [{ id: 100, name: "Plato 0", price: 1, active: true, categoryId: null }],
      categories: [],
      products,
    });
    assert.deepEqual(plan.deactivate, []);
    assert.equal(plan.deactivationBlocked, 9);
  });

  it("con pocos vinculados (menos de 4) sí desactiva aunque falten", () => {
    const plan = planCatalogSync({
      fudoCategories: [],
      fudoProducts: [{ id: 100, name: "A", price: 1, active: true, categoryId: null }],
      categories: [],
      products: [prod("p0", "A", 100, { price: 1 }), prod("p1", "B", 101)],
    });
    assert.deepEqual(plan.deactivate, ["p1"]);
    assert.equal(plan.deactivationBlocked, 0);
  });

  it("asigna una categoría nueva a un producto existente sin categoría (no lo da por sin cambios)", () => {
    const plan = planCatalogSync({
      fudoCategories: [{ id: 3, name: "Pizzas" }],
      fudoProducts: [{ id: 7, name: "Muzza", price: 9500, active: true, categoryId: 3 }],
      categories: [],
      products: [prod("p1", "Muzza", 7, { price: 9500, category_id: null })],
    });
    assert.equal(plan.productUpdates.length, 1);
    assert.equal(plan.productUpdates[0].category_fudo_id, 3);
  });

  it("no crea categorías sin productos para sincronizar (evita pestañas vacías en la carta)", () => {
    const plan = planCatalogSync({
      fudoCategories: [{ id: 1, name: "Pizzas" }, { id: 2, name: "Pedidos Ya" }],
      fudoProducts: [
        { id: 10, name: "Muzza", price: 9500, active: true, categoryId: 1 },
        { id: 11, name: "Viejo", price: 100, active: false, categoryId: 2 },
      ],
      categories: [],
      products: [],
    });
    assert.deepEqual(plan.categoryInserts, [{ name: "Pizzas", fudo_id: 1 }]);
  });
});


const GROUP_1 = {
  type: "ProductModifiersGroup", id: "1",
  attributes: { name: "Elige tu Relleno", minQuantity: null, maxQuantity: 1.0, required: false, kind: "EXTRAS", priceAggregation: "SUM" },
  relationships: { productModifiers: { data: [{ id: "1" }, { id: "2" }] } },
};
const GROUP_3 = {
  type: "ProductModifiersGroup", id: "3",
  attributes: { name: "bebidas promo", minQuantity: 2.0, maxQuantity: 2.0, required: false, kind: "EXTRAS", priceAggregation: "SUM" },
  relationships: { productModifiers: { data: [] } },
};
const modifier = (id: string, productId: string, groupId: string) => ({
  type: "ProductModifier", id,
  attributes: { name: null, price: 0.0 },
  relationships: { product: { data: { type: "Product", id: productId } }, productModifiersGroup: { data: { type: "ProductModifiersGroup", id: groupId } } },
});
const apiProduct = (id: string, name: string, price: number, groups: string[] = []) => ({
  type: "Product", id,
  attributes: { name, price, active: true, sellAlone: true },
  relationships: { productModifiersGroups: { data: groups.map((g) => ({ id: g })) } },
});

describe("parseFudoModifierGroups / parseFudoModifiers", () => {
  it("lee grupos JSON:API", () => {
    assert.deepEqual(parseFudoModifierGroups({ data: [GROUP_1, GROUP_3, { id: "x" }] }), [
      { id: 1, name: "Elige tu Relleno", minQty: null, maxQty: 1, required: false, kind: "EXTRAS" },
      { id: 3, name: "bebidas promo", minQty: 2, maxQty: 2, required: false, kind: "EXTRAS" },
    ]);
  });

  it("lee modificadores con el producto y el grupo de las relaciones", () => {
    assert.deepEqual(parseFudoModifiers({ data: [modifier("1", "193", "1"), { id: "9", attributes: {} }] }), [
      { id: 1, groupId: 1, productId: 193, name: null, price: 0 },
    ]);
  });

  it("parseFudoProducts lee los grupos del producto", () => {
    const [p, q] = parseFudoProducts({ data: [apiProduct("212", "Docena de empanadas", 36000, ["1", "1"]), apiProduct("5", "Muzza", 9000)] });
    assert.deepEqual(p.modifierGroupIds, [1]);
    assert.deepEqual(q.modifierGroupIds, []);
  });
});

describe("planModifierSync", () => {
  const products = parseFudoProducts({ data: [apiProduct("193", "Carne cortada a cuchillo", 0), apiProduct("192", "Jamón y queso", 0), apiProduct("212", "Docena de empanadas", 36000, ["1"])] });
  const plan = planModifierSync({
    groups: parseFudoModifierGroups({ data: [GROUP_1] }),
    modifiers: parseFudoModifiers({ data: [modifier("1", "193", "1"), modifier("2", "192", "1"), modifier("3", "999", "1"), modifier("4", "193", "77")] }),
    products,
  });

  it("nombra cada opción por su producto sabor y descarta las huérfanas", () => {
    assert.deepEqual(plan.options.map((o) => [o.fudo_id, o.name, o.position, o.price_cents, o.is_active]), [
      [1, "Carne cortada a cuchillo", 0, 0, 1],
      [2, "Jamón y queso", 1, 0, 1],
    ]);
  });

  it("arma el grupo y el vínculo producto-grupo", () => {
    assert.deepEqual(plan.groups, [{ fudo_id: 1, name: "Elige tu Relleno", min_qty: null, max_qty: 1, required: 0, kind: "EXTRAS" }]);
    assert.deepEqual(plan.productGroups, [{ product_fudo_id: 212, group_fudo_id: 1 }]);
  });
});

describe("planCatalogSync con grupos de modificadores", () => {
  const categories = [{ id: 9, name: "Productos genéricos" }, { id: 10, name: "Opciones" }];
  const fudoProducts = [
    { id: 212, name: "Docena de empanadas", price: 36000, active: true, categoryId: 9, sellAlone: false, modifierGroupIds: [1] },
    { id: 300, name: "Pepsi (Lata)", price: 2000, active: true, categoryId: 9, sellAlone: true, modifierGroupIds: [] },
    { id: 193, name: "Carne cortada a cuchillo", price: 0, active: true, categoryId: 10, sellAlone: false, modifierGroupIds: [] },
    { id: 301, name: "Sabor con precio", price: 500, active: true, categoryId: 10, sellAlone: false, modifierGroupIds: [] },
  ];

  it("importa la docena (con grupos) y no el resto de lo excluido", () => {
    const plan = planCatalogSync({ fudoCategories: categories, fudoProducts, categories: [], products: [] });
    assert.deepEqual(plan.productInserts.map((p) => p.fudo_id), [212]);
    assert.equal(plan.productInserts[0].category_fudo_id, null);
    assert.deepEqual(plan.categoryInserts, []);
  });

  it("no la importa si está inactiva o sin precio", () => {
    for (const patch of [{ active: false }, { price: 0 }, { price: null }]) {
      const plan = planCatalogSync({ fudoCategories: categories, fudoProducts: [{ ...fudoProducts[0], ...patch }, fudoProducts[1]], categories: [], products: [] });
      assert.deepEqual(plan.productInserts.map((p) => p.fudo_id), []);
    }
  });

  it("es idempotente: la docena ya importada no genera actualización", () => {
    const existing = [{ id: "p1", name: "Docena de empanadas", fudo_id: 212, price: 36000, is_active: true, category_id: null }];
    const plan = planCatalogSync({ fudoCategories: categories, fudoProducts, categories: [], products: existing });
    assert.deepEqual(plan.productUpdates, []);
    assert.deepEqual(plan.deactivate, []);
  });
});
