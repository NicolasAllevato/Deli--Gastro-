/** Empanadas sueltas por gusto, opciones por línea (promos con bebida) y grupos de opciones en get_menu. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { d1BotRepo } from "../workers/whatsapp-bot/src/repo/d1.ts";
import { toolsFor, orderTools } from "../workers/whatsapp-bot/src/bot/tools.ts";
import { buildResponderPrompt } from "../workers/whatsapp-bot/src/bot/prompts.ts";
import { optionGroupsForModel } from "../workers/whatsapp-bot/src/bot/menu.ts";
import { settingsFromConfig } from "../workers/whatsapp-bot/src/bot/settings.ts";
import { parseQuoteArgs, runQuote } from "../workers/whatsapp-bot/src/orders/flow.ts";
import { fakeOrders, openSimDb, seedWorld } from "../scripts/simulador/mundo.ts";

const PID = "00000000-0000-4000-8000-000000000001";
const base = { items: [{ product_id: PID, qty: 2 }], address: "Belgrano 123" };
const conversation = { id: "c", phone: "1", clientId: null, displayName: null, humanTakeover: false };

function world() {
  const db = openSimDb(":memory:");
  seedWorld(db);
  return db;
}

describe("parseQuoteArgs con options por línea", () => {
  it("acepta options válidas y las conserva", () => {
    const out = parseQuoteArgs({ ...base, items: [{ product_id: PID, qty: 1, options: [{ option_id: 7, qty: 1 }, { option_id: 9, qty: 2 }] }] });
    assert.deepEqual(out?.items[0]?.options, [{ option_id: 7, qty: 1 }, { option_id: 9, qty: 2 }]);
    assert.equal(parseQuoteArgs(base)?.items[0]?.options, undefined);
  });

  it("rechaza claves extra, no enteros, qty fuera de 1..100 y más de 30 opciones", () => {
    const withOptions = (options: unknown) => parseQuoteArgs({ ...base, items: [{ product_id: PID, qty: 1, options }] });
    assert.equal(withOptions([{ option_id: 1, qty: 1, price: 0 }]), null);
    assert.equal(withOptions([{ option_id: 1.5, qty: 1 }]), null);
    assert.equal(withOptions([{ option_id: "1", qty: 1 }]), null);
    assert.equal(withOptions([{ option_id: 1, qty: 0 }]), null);
    assert.equal(withOptions([{ option_id: 1, qty: 101 }]), null);
    assert.equal(withOptions("x"), null);
    assert.equal(withOptions(Array.from({ length: 31 }, (_, i) => ({ option_id: i + 1, qty: 1 }))), null);
    assert.ok(withOptions(Array.from({ length: 30 }, (_, i) => ({ option_id: i + 1, qty: 1 }))));
  });

  it("el error de argumentos menciona options", async () => {
    const t = { state: {} } as unknown as Parameters<typeof runQuote>[0];
    const out = (await runQuote(t, { items: [{ product_id: PID, qty: 1, options: [{ option_id: 1 }] }], address: "Belgrano 123" })) as { error: string };
    assert.match(out.error, /options/);
    assert.match(out.error, /no inventes/i);
  });
});

describe("textos: descripción de quote_order y prompt", () => {
  const tool = orderTools({ state: {} } as unknown as Parameters<typeof runQuote>[0]).find((x) => x.name === "quote_order")!;

  it("manda cada gusto suelto con la cantidad total y no usa la docena", () => {
    assert.match(tool.description, /CADA GUSTO/);
    assert.match(tool.description, /CANTIDAD TOTAL/);
    assert.match(tool.description, /31 de carne/);
    assert.match(tool.description, /NO uses productos «docena»/);
    assert.match(tool.description, /EXACTAMENTE/);
    assert.match(tool.description, /ANTES de cotizar.*gustos/i);
    // Si el cliente ya nombró el gusto no se sobrepregunta (mezclar / suave o picante).
    assert.match(tool.description, /NO preguntes si quiere mezclar/);
    assert.match(tool.description, /solo es la picante si dice «picante»/);
    assert.doesNotMatch(tool.description, /carne suave vs carne picante/);
    assert.match(tool.description, /Nunca rechaces/i);
    assert.match(tool.description, /sin inventar un motivo/);
    assert.doesNotMatch(tool.description, /floor\(N\/12\)|mod 12/);
  });

  it("el esquema acepta options por línea (estricto)", () => {
    const params = tool.parameters as { properties: { items: { items: { properties: { options: { items: { additionalProperties: boolean; required: string[] } } } } } } };
    const opt = params.properties.items.items.properties.options.items;
    assert.equal(opt.additionalProperties, false);
    assert.deepEqual(opt.required, ["option_id", "qty"]);
  });

  it("el prompt ya no manda hacer cuentas de docenas", () => {
    const prompt = buildResponderPrompt(settingsFromConfig({ bot_orders_enabled: true }), "pedido_nuevo", null, false);
    assert.doesNotMatch(prompt, /floor\(N\/12\)/);
    assert.match(prompt, /el sistema arma las docenas solo/);
    assert.match(prompt, /cantidad EXACTA/);
    assert.match(prompt, /preguntá siempre los gustos/);
  });

  it("get_menu menciona grupos_de_opciones", () => {
    const get = toolsFor("consulta_menu", d1BotRepo(world()), conversation, settingsFromConfig({}), Date.now, {} as never).find((t) => t.name === "get_menu")!;
    assert.match(get.description, /grupos_de_opciones/);
  });
});

describe("menu() y get_menu con grupos de opciones", () => {
  function withPromo() {
    const db = world();
    const cat = (db.raw.prepare("SELECT id FROM categories LIMIT 1").get() as { id: string }).id;
    db.raw.prepare("INSERT INTO products (id, category_id, name, price_cents, is_active, show_in_portal, fudo_id) VALUES ('promo-1', ?, 'Promo 2 pizzas + bebidas', 3000000, 1, 1, 50)").run(cat);
    db.raw.prepare("INSERT INTO fudo_modifier_groups (fudo_id, name, min_qty, max_qty, required) VALUES (3, 'bebidas promo', 2, 2, 1)").run();
    db.raw.prepare("INSERT INTO fudo_modifier_options (fudo_id, group_fudo_id, product_fudo_id, name, position) VALUES (30, 3, 300, 'Coca-Cola', 2), (31, 3, 301, 'Sprite', 1), (32, 3, 302, 'Fanta', 3)").run();
    db.raw.prepare("UPDATE fudo_modifier_options SET is_active = 0 WHERE fudo_id = 32").run();
    db.raw.prepare("INSERT INTO fudo_product_groups (product_fudo_id, group_fudo_id) VALUES (50, 3)").run();
    return db;
  }

  it("el producto con grupos trae sus ids y la docena sigue oculta", async () => {
    const menu = await d1BotRepo(withPromo()).menu();
    assert.deepEqual(menu.find((p) => p.id === "promo-1")?.groups, [3]);
    assert.equal(menu.some((p) => p.name === "Docena de empanadas"), false);
    assert.equal(menu.find((p) => p.name === "Muzzarella grande")?.groups, undefined);
  });

  it("optionGroups: solo opciones activas, ordenadas por posición", async () => {
    const groups = await d1BotRepo(withPromo()).optionGroups!();
    assert.deepEqual(groups["3"], { name: "bebidas promo", min: 2, max: 2, options: [{ id: 31, name: "Sprite" }, { id: 30, name: "Coca-Cola" }] });
  });

  it("get_menu: grupos_de_opciones solo con grupos usados por el menú visible", async () => {
    const repo = d1BotRepo(withPromo());
    const get = toolsFor("consulta_menu", repo, conversation, settingsFromConfig({}), Date.now, {} as never).find((t) => t.name === "get_menu")!;
    const out = (await get.run({})) as { grupos_de_opciones?: Record<string, { nombre: string; opciones: { id: number; nombre: string }[] }>; otras_categorias?: unknown; categorias?: { productos: { id?: string; grupos?: number[] }[] }[] };
    assert.deepEqual(Object.keys(out.grupos_de_opciones ?? {}), ["3"]);
    assert.deepEqual(out.grupos_de_opciones?.["3"]?.opciones, [{ id: 31, nombre: "Sprite" }, { id: 30, nombre: "Coca-Cola" }]);
    const promo = out.categorias?.flatMap((c) => c.productos).find((p) => p.id === "promo-1");
    assert.deepEqual(promo?.grupos, [3]);
    // El grupo de la docena (oculta) no se publica.
    assert.equal(out.grupos_de_opciones?.["1"], undefined);
  });

  it("sin pedidos encendidos get_menu no trae grupos", async () => {
    const get = toolsFor("consulta_menu", d1BotRepo(withPromo()), conversation, settingsFromConfig({}), Date.now).find((t) => t.name === "get_menu")!;
    const out = (await get.run({})) as Record<string, unknown>;
    assert.equal(out.grupos_de_opciones, undefined);
  });

  it("si las tablas no existen o falla la consulta, el menú sigue sin grupos", async () => {
    const db = world();
    db.raw.exec("DROP TABLE fudo_product_groups; DROP TABLE fudo_modifier_options; DROP TABLE fudo_modifier_groups;");
    const repo = d1BotRepo(db);
    const menu = await repo.menu();
    assert.ok(menu.length > 0);
    assert.ok(menu.every((p) => p.groups === undefined));
    assert.deepEqual(await repo.optionGroups!(), {});
  });

  it("optionGroupsForModel omite grupos sin uso o sin opciones", () => {
    const menu = [{ id: "a", name: "A", description: null, price: 1, category: "X", groups: [1] }];
    const groups = { "1": { name: "G1", min: 1, max: 1, options: [{ id: 5, name: "o" }] }, "2": { name: "G2", min: 0, max: 1, options: [{ id: 6, name: "p" }] }, "3": { name: "G3", min: 0, max: 1, options: [] } };
    assert.deepEqual(Object.keys(optionGroupsForModel(menu, groups)), ["1"]);
    assert.deepEqual(optionGroupsForModel([{ ...menu[0]!, groups: [3] }], groups), {});
  });
});

describe("simulador: cotización con empaquetado de docenas", () => {
  const idOf = (db: ReturnType<typeof world>, name: string) => (db.raw.prepare("SELECT id FROM products WHERE name = ?").get(name) as { id: string }).id;
  const quote = async (db: ReturnType<typeof world>, items: { name: string; qty: number }[]) => {
    const r = await fakeOrders(db).quote({ conversationId: "c", inboundWamid: "w", items: items.map((i) => ({ product_id: idOf(db, i.name), qty: i.qty })), address: "Palermo 123" });
    assert.ok(r.ok);
    return (r as unknown as { data: { lines: { name: string; qty: number; options?: { name: string; qty: number }[] }[] } }).data.lines;
  };

  it("31 de carne: 2 docenas y 7 sueltas (31 unidades, no 44)", async () => {
    const db = world();
    const lines = await quote(db, [{ name: "Empanada de carne cortada a cuchillo", qty: 31 }]);
    assert.deepEqual(lines.map((l) => [l.name, l.qty]), [["Docena de empanadas", 2], ["Empanada de carne cortada a cuchillo", 7]]);
    assert.deepEqual(lines[0]?.options, [{ name: "Carne cortada a cuchillo", qty: 12 }]);
  });

  it("6 de carne y 6 de jamón y queso: una docena mezclada", async () => {
    const db = world();
    const lines = await quote(db, [{ name: "Empanada de carne cortada a cuchillo", qty: 6 }, { name: "Empanada de jamón y queso", qty: 6 }]);
    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0], { name: "Docena de empanadas", qty: 1, price: 36000, options: [{ name: "Jamón y queso", qty: 6 }, { name: "Carne cortada a cuchillo", qty: 6 }] });
  });
});
