import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { packEmpanadas, buildPackContext } = await import("../src/lib/agent/empanadas.ts");
const { validateLineOptions, buildModifierCatalog, normalizeOptions } = await import("../src/lib/order-options.ts");
const { parseDraft } = await import("../src/lib/agent/draft.ts");
const { quoteSchema } = await import("../src/lib/bot-internal/schemas.ts");
const { productSales } = await import("../src/lib/reports/product-sales.ts");

const CARNE = "c0000000-0000-4000-8000-000000000001";
const JAMON = "c0000000-0000-4000-8000-000000000002";
const DOCENA = "d0000000-0000-4000-8000-000000000000";
const PEPSI = "e0000000-0000-4000-8000-000000000000";
const ctx = { docenaProductId: DOCENA, docenaUnits: 12, looseToOption: new Map([[CARNE, 1], [JAMON, 2]]) };
const sueltas = (...pairs: Array<[string, number]>) => pairs.map(([product_id, qty]) => ({ product_id, qty }));

describe("packEmpanadas", () => {
  it("31 de carne: docena x2 de 12 carne + 7 sueltas", () => {
    const out = packEmpanadas(sueltas([CARNE, 31]), ctx);
    assert.deepEqual(out, [
      { product_id: DOCENA, qty: 2, options: [{ option_id: 1, qty: 12 }] },
      { product_id: CARNE, qty: 7 },
    ]);
  });

  it("20 carne + 11 jamón: docena de carne, docena mezclada y 7 de jamón", () => {
    const out = packEmpanadas(sueltas([CARNE, 20], [JAMON, 11]), ctx);
    assert.deepEqual(out, [
      { product_id: DOCENA, qty: 1, options: [{ option_id: 1, qty: 12 }] },
      { product_id: DOCENA, qty: 1, options: [{ option_id: 1, qty: 8 }, { option_id: 2, qty: 4 }] },
      { product_id: JAMON, qty: 7 },
    ]);
  });

  it("menos de una docena queda intacto; 44 sueltas son 3 docenas + 8", () => {
    const eleven = sueltas([CARNE, 11]);
    assert.deepEqual(packEmpanadas(eleven, ctx), eleven);
    const out = packEmpanadas(sueltas([CARNE, 44]), ctx);
    assert.deepEqual(out, [{ product_id: DOCENA, qty: 3, options: [{ option_id: 1, qty: 12 }] }, { product_id: CARNE, qty: 8 }]);
  });

  it("suma líneas repetidas del mismo gusto y conserva el resto del pedido", () => {
    const out = packEmpanadas([{ product_id: PEPSI, qty: 1 }, ...sueltas([CARNE, 6], [JAMON, 3], [CARNE, 6])], ctx);
    assert.deepEqual(out, [
      { product_id: PEPSI, qty: 1 },
      { product_id: DOCENA, qty: 1, options: [{ option_id: 1, qty: 12 }] },
      { product_id: JAMON, qty: 3 },
    ]);
  });

  it("una docena que ya trae opciones pasa intacta y es idempotente", () => {
    const own = [{ product_id: DOCENA, qty: 1, options: [{ option_id: 2, qty: 12 }] }, ...sueltas([CARNE, 5])];
    assert.deepEqual(packEmpanadas(own, ctx), own);
    const once = packEmpanadas(sueltas([CARNE, 20], [JAMON, 11]), ctx);
    assert.deepEqual(packEmpanadas(once, ctx), once);
  });

  it("sin contexto (sin docena o sin config) no empaqueta", () => {
    const lines = sueltas([CARNE, 30]);
    assert.deepEqual(packEmpanadas(lines, null), lines);
  });

  it("buildPackContext resuelve ids Fudo y devuelve null sin producto docena", () => {
    const src = {
      docenaFudoId: 212, docenaUnits: 12, gustosMap: { "31": 200, "32": 197 },
      products: [{ id: CARNE, fudo_id: 31 }, { id: JAMON, fudo_id: 32 }, { id: DOCENA, fudo_id: 212 }],
      docenaOptions: [
        { fudo_id: 1, group_fudo_id: 1, product_fudo_id: 200, name: "Carne", price_cents: 0, is_active: true },
        { fudo_id: 2, group_fudo_id: 1, product_fudo_id: 197, name: "Jamón", price_cents: 0, is_active: true },
      ],
    };
    const built = buildPackContext(src);
    assert.equal(built?.docenaProductId, DOCENA);
    assert.deepEqual([...built!.looseToOption], [[CARNE, 1], [JAMON, 2]]);
    assert.equal(buildPackContext({ ...src, products: src.products.slice(0, 2) }), null);
    // D1 devuelve is_active como 0/1: una docena desactivada (0 o false) no se empaqueta.
    const inactiva = (v: boolean | number) => src.products.map((p) => (p.id === DOCENA ? { ...p, is_active: v } : p));
    assert.equal(buildPackContext({ ...src, products: inactiva(0) }), null);
    assert.equal(buildPackContext({ ...src, products: inactiva(false) }), null);
    assert.equal(buildPackContext({ ...src, products: inactiva(1) })?.docenaProductId, DOCENA);
  });
});

const catalog = buildModifierCatalog({
  groups: [
    { fudo_id: 1, name: "Elige tu Relleno", min_qty: null, max_qty: 1 },
    { fudo_id: 3, name: "bebidas promo", min_qty: 2, max_qty: 2 },
  ],
  options: [
    { fudo_id: 1, group_fudo_id: 1, product_fudo_id: 200, name: "Carne", price_cents: 0, position: 0, is_active: true },
    { fudo_id: 2, group_fudo_id: 1, product_fudo_id: 197, name: "Jamón y queso", price_cents: 0, position: 1, is_active: true },
    { fudo_id: 10, group_fudo_id: 3, product_fudo_id: 300, name: "Pepsi", price_cents: 0, position: 0, is_active: true },
    { fudo_id: 11, group_fudo_id: 3, product_fudo_id: 301, name: "Sprite", price_cents: 50000, position: 1, is_active: true },
  ],
  productGroups: [{ product_fudo_id: 212, group_fudo_id: 1 }, { product_fudo_id: 50, group_fudo_id: 3 }],
});
type Opts = Array<{ option_id: number; qty: number }> | undefined;
const docena = (options: Opts) =>
  validateLineOptions({ productName: "Docena", productFudoId: 212, isDocena: true, docenaUnits: 12, options }, catalog);
const promo = (options: Opts) =>
  validateLineOptions({ productName: "Promo", productFudoId: 50, isDocena: false, docenaUnits: 12, options }, catalog);
const messageOf = (r: { ok: boolean; message?: string }): string => (r.ok ? "" : String(r.message));

describe("validateLineOptions", () => {
  it("docena sin gustos o incompleta pide los gustos", () => {
    for (const opts of [undefined, [{ option_id: 1, qty: 5 }]]) {
      const r = docena(opts);
      assert.equal(r.ok, false);
      assert.match(messageOf(r), /Faltan gustos de la docena: elegí 12 en total/);
    }
    assert.match(messageOf(docena([{ option_id: 1, qty: 13 }])), /Sobran gustos/);
  });

  it("docena con 12 gustos es válida y no suma precio", () => {
    const r = docena([{ option_id: 2, qty: 4 }, { option_id: 1, qty: 8 }]);
    assert.ok(r.ok);
    assert.equal(r.unitExtra, 0);
    assert.deepEqual(r.options.map((o) => [o.option_id, o.qty, o.group_fudo_id]), [[1, 8, 1], [2, 4, 1]]);
  });

  it("una opción de otro grupo se rechaza", () => {
    const r = docena([{ option_id: 10, qty: 12 }]);
    assert.equal(r.ok, false);
    assert.match(messageOf(r), /no corresponde/);
  });

  it("bebidas promo (min 2 max 2): sin elegir pide la elección con los nombres; con 1 o 3 no vale", () => {
    assert.match(messageOf(promo(undefined)), /elegí 2 de «bebidas promo»: Pepsi, Sprite/);
    assert.equal(promo([{ option_id: 10, qty: 1 }]).ok, false);
    assert.equal(promo([{ option_id: 10, qty: 2 }, { option_id: 11, qty: 1 }]).ok, false);
  });

  it("el precio sale del catálogo, no del modelo", () => {
    const r = promo([{ option_id: 10, qty: 1 }, { option_id: 11, qty: 1 }]);
    assert.ok(r.ok);
    assert.equal(r.unitExtra, 500);
  });

  it("producto sin grupos con opciones se rechaza; qty inválida también", () => {
    assert.equal(validateLineOptions({ productName: "X", productFudoId: 9, isDocena: false, docenaUnits: 12, options: [{ option_id: 1, qty: 1 }] }, catalog).ok, false);
    assert.equal(promo([{ option_id: 10, qty: 0 }]).ok, false);
    assert.equal(promo([{ option_id: 10, qty: 1.5 }]).ok, false);
  });

  it("normalizeOptions une repetidas y ordena", () => {
    assert.deepEqual(normalizeOptions([{ option_id: 2, qty: 1 }, { option_id: 1, qty: 2 }, { option_id: 2, qty: 3 }]), [{ option_id: 1, qty: 2 }, { option_id: 2, qty: 4 }]);
  });
});

describe("borrador y esquema conservan options", () => {
  it("parseDraft no pierde options", () => {
    const draft = {
      items: [{ productId: DOCENA, qty: 2, options: [{ option_id: 1, qty: 12 }] }, { productId: CARNE, qty: 3 }],
      address: "x", lat: 0, lng: 0, fee: 0, subtotal: 1, minOrder: 0, quotedByMessageId: "w", quotedAt: new Date().toISOString(),
    };
    assert.deepEqual(parseDraft({ draft })?.items, draft.items);
  });

  it("quoteSchema acepta options y sigue rechazando campos extra", () => {
    const body = { conversationId: "c", inboundWamid: "w", address: "Corrientes 1234", items: [{ product_id: DOCENA, qty: 1, options: [{ option_id: 1, qty: 12 }] }] };
    assert.equal(quoteSchema.safeParse(body).success, true);
    assert.equal(quoteSchema.safeParse({ ...body, items: [{ ...body.items[0], price: 1 }] }).success, false);
    assert.equal(quoteSchema.safeParse({ ...body, items: [{ ...body.items[0], options: [{ option_id: 1, qty: 1, price: 0 }] }] }).success, false);
  });
});

describe("product-sales: sabores de la app no vuelven combo la línea", () => {
  const bounds = { from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" };
  const order = (line: Record<string, unknown>) => ({ status: "Finalizados", created_at: "2026-10-20T15:00:00.000Z", items_desc: "", order_items: [line] }) as never;
  const opt = { qty: 6, name: "Carne", product_id: CARNE, fudo_product_id: 200, group_fudo_id: 1, option_fudo_id: 1 };

  it("docena con gustos: producto con su monto y los gustos suman unidades a $0", () => {
    const r = productSales([order({ product_id: DOCENA, name: "Docena de empanadas", qty: 2, unit_price: 36000, is_combo: false, fudo_options: [opt] })], bounds, new Map(), 10);
    assert.deepEqual(r.combos, []);
    assert.deepEqual(r.products.map((p) => [p.name, p.units, p.revenue]).sort(), [["Carne", 12, 0], ["Docena de empanadas", 2, 72000]]);
  });

  it("opciones de Fudo (sin option_fudo_id) siguen marcando combo", () => {
    const r = productSales([order({ product_id: null, name: "Genérico", qty: 1, unit_price: 100, is_combo: false, fudo_options: [{ qty: 1, name: "Algo" }] })], bounds, new Map(), 10);
    assert.equal(r.combos.length, 1);
  });
});
