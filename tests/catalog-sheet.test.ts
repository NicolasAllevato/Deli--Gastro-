import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CATALOG_HEADERS,
  parseCatalogRows,
  parseCsv,
  planImport,
  productsToRows,
} from "../src/lib/catalog/sheet.ts";
import type { Category, Product } from "../src/types/catalog.ts";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const CAT_PIZZAS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const categories: Category[] = [{ id: CAT_PIZZAS, name: "Pizzas", description: "", is_active: true, points_per_100: null }];
const products: Product[] = [
  { id: ID_A, name: "Muzzarella", description: "Clásica", price: 9000, image_url: "", category_id: CAT_PIZZAS, is_active: true, points_per_100: null },
  { id: ID_B, name: "Fugazzeta", description: "", price: 10500, image_url: "", category_id: CAT_PIZZAS, is_active: false, points_per_100: null },
];

describe("exportación de la carta", () => {
  it("genera una fila por producto con la categoría por nombre", () => {
    const rows = productsToRows(products, categories);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], [ID_A, "Pizzas", "Muzzarella", "Clásica", 9000, "Sí", "", ""]);
    assert.equal(rows[1][5], "No");
    assert.equal(CATALOG_HEADERS.length, rows[0].length);
  });
});

describe("parseCsv", () => {
  it("detecta ; (Excel es-AR), comillas y saltos dentro de celda", () => {
    const text = '\uFEFFNombre;Precio\r\n"Pizza; grande";"1.500,50"\r\n"Con\nsalto";200\r\n';
    assert.deepEqual(parseCsv(text), [
      ["Nombre", "Precio"],
      ["Pizza; grande", "1.500,50"],
      ["Con\nsalto", "200"],
    ]);
  });

  it("detecta coma como separador", () => {
    assert.deepEqual(parseCsv("a,b\n1,\"x,y\"\n"), [["a", "b"], ["1", "x,y"]]);
  });
});

describe("parseCatalogRows", () => {
  it("reconoce encabezados sin importar mayúsculas ni tildes y parsea precios", () => {
    const { rows, errors } = parseCatalogRows([
      ["nombre", "PRECIO", "categoria", "Activo"],
      ["Napolitana", "$ 1.234,50", "Pizzas", "si"],
      ["Gaseosa", 800, "", "no"],
    ]);
    assert.deepEqual(errors, []);
    assert.equal(rows[0].price, 1234.5);
    assert.equal(rows[0].isActive, true);
    assert.equal(rows[1].price, 800);
    assert.equal(rows[1].isActive, false);
    assert.equal(rows[1].line, 3);
  });

  it("falla si faltan las columnas obligatorias", () => {
    const { rows, errors } = parseCatalogRows([["Categoría", "Activo"], ["Pizzas", "Sí"]]);
    assert.equal(rows.length, 0);
    assert.match(errors[0].message, /Nombre/);
  });

  it("reporta filas con nombre vacío o precio inválido y sigue con el resto", () => {
    const { rows, errors } = parseCatalogRows([
      ["Nombre", "Precio"],
      ["", 100],
      ["Flan", "abc"],
      ["Flan", -5],
      ["Helado", 300],
      ["", ""],
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "Helado");
    assert.deepEqual(errors.map((e) => e.line), [2, 3, 4]);
  });
});

describe("planImport", () => {
  const parse = (data: unknown[][]) => parseCatalogRows([["ID", "Nombre", "Precio", "Categoría"], ...data]).rows;

  it("actualiza por ID y reporta solo lo que cambió", () => {
    const plan = planImport(parse([[ID_A, "Muzzarella", 9500, "Pizzas"]]), products, categories);
    assert.equal(plan.updates.length, 1);
    assert.deepEqual(plan.updates[0].changes, ["precio"]);
    assert.equal(plan.updates[0].id, ID_A);
    assert.equal(plan.creates.length, 0);
  });

  it("sin ID empareja por nombre y categoría, ignorando mayúsculas", () => {
    const plan = planImport(parse([["", "  fugazzeta ", 10500, "pizzas"]]), products, categories);
    assert.equal(plan.unchanged, 1);
    assert.equal(plan.updates.length, 0);
    assert.equal(plan.creates.length, 0);
  });

  it("crea productos nuevos y las categorías que no existen", () => {
    const plan = planImport(parse([["", "Tiramisú", 4000, "Postres"]]), products, categories);
    assert.equal(plan.creates.length, 1);
    assert.deepEqual(plan.newCategories, ["Postres"]);
  });

  it("rechaza filas repetidas del mismo producto", () => {
    const plan = planImport(parse([[ID_A, "Muzzarella", 1, ""], [ID_A, "Muzzarella", 2, ""]]), products, categories);
    assert.equal(plan.errors.length, 1);
    assert.equal(plan.updates.length, 1);
  });

  it("un ID inexistente se trata como error, no como alta", () => {
    const plan = planImport(parse([["33333333-3333-4333-8333-333333333333", "X", 1, ""]]), products, categories);
    assert.equal(plan.errors.length, 1);
    assert.equal(plan.creates.length, 0);
  });
});

describe("puntos en la planilla", () => {
  it("lee 'Puntos por $100' y detecta el cambio; vacío = hereda", () => {
    const { rows, errors } = parseCatalogRows([
      ["ID", "Nombre", "Precio", "Puntos por $100"],
      [ID_A, "Muzzarella", 9000, "2,5"],
      [ID_B, "Fugazzeta", 10500, ""],
    ]);
    assert.deepEqual(errors, []);
    const plan = planImport(rows, products, categories);
    assert.deepEqual(plan.updates.map((u) => [u.id, u.changes, u.patch.points_per_100]), [[ID_A, ["puntos"], 2.5]]);
    assert.equal(plan.unchanged, 1);
  });

  it("rechaza puntos negativos", () => {
    const { errors } = parseCatalogRows([["Nombre", "Precio", "Puntos"], ["X", 1, -1]]);
    assert.equal(errors.length, 1);
  });
});
