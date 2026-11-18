/** Carta estructurada: datos (precios vivos), PDF con el diseño de la carta, respaldo por categorías, bot y admin. */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "./helpers/alias.ts";
import { createTestDb, seed, actors } from "./helpers/sqlite-d1.ts";
import { ForbiddenError } from "../src/lib/data/actor.ts";
import { CartaError, cartaInputSchema, getCartaAdmin, getCartaPublica, saveCarta, type CartaInput } from "../src/lib/data/carta.ts";
import { renderCartaPdf, pesosCarta, winAnsi } from "../src/lib/carta-pdf/render.ts";
import { seccionesDesdeCarta, seccionesDesdeCategorias } from "../src/lib/carta-pdf/build.ts";
import { d1BotRepo } from "../workers/whatsapp-bot/src/repo/d1.ts";
import { cartaCategoryForModel, cartaMenuForModel, cartaSectionsFor, formatCartaSeccion } from "../workers/whatsapp-bot/src/bot/menu.ts";
import { toolsFor } from "../workers/whatsapp-bot/src/bot/tools.ts";
import { settingsFromConfig } from "../workers/whatsapp-bot/src/bot/settings.ts";
import type { BotRepo, CartaSeccion, MenuItem } from "../workers/whatsapp-bot/src/repo/types.ts";

let db: ReturnType<typeof createTestDb>;

function addProduct(id: string, name: string, cents: number, active = 1) {
  db.raw.prepare("INSERT INTO products (id, category_id, name, price_cents, is_active, show_in_portal) VALUES (?, 'cat-1', ?, ?, ?, 1)").run(id, name, cents, active);
}

const CARTA: CartaInput = {
  secciones: [
    {
      id: "s-pizzas", titulo: "Pizzas", columnas: ["8 porciones", "Porción"], estilo: "lista", nota: null, activo: true,
      items: [
        { id: "i-muzza", nombre: "Muzzarella", nota: null, producto_id: "p-gde-muzza", producto_id_2: "p-porc-muzza", activo: true },
        { id: "i-cancha", nombre: "Pizza de cancha", nota: "salsa putanesca y anchoas", producto_id: null, producto_id_2: null, activo: true },
      ],
    },
    {
      id: "s-empa", titulo: "Empanadas", columnas: [], estilo: "gustos", nota: null, activo: true,
      items: [
        { id: "i-carne", nombre: "Carne Suave", nota: null, producto_id: "p-emp-carne", producto_id_2: null, activo: true },
        { id: "i-pollo", nombre: "Pollo", nota: null, producto_id: "p-emp-pollo", producto_id_2: null, activo: true },
      ],
    },
    { id: "s-oculta", titulo: "Oculta", columnas: [], estilo: "lista", nota: null, activo: false, items: [{ id: "i-x", nombre: "X", nota: null, producto_id: null, producto_id_2: null, activo: true }] },
  ],
};

beforeEach(async () => {
  db = createTestDb();
  seed(db);
  addProduct("p-gde-muzza", "Grande de muzzarella", 2_500_000);
  addProduct("p-porc-muzza", "Porcion Muzzarella", 360_000);
  addProduct("p-emp-carne", "Empanada de carne", 350_000);
  addProduct("p-emp-pollo", "Empanada de pollo", 350_000);
});

describe("carta estructurada: datos", () => {
  it("vacía sin filas (se usa el respaldo por categorías)", async () => {
    assert.deepEqual(await getCartaPublica(db, actors.anon), []);
  });

  it("los precios salen vivos de products (cambia el precio, cambia la carta)", async () => {
    await saveCarta(db, actors.admin, CARTA);
    let carta = await getCartaPublica(db, actors.anon);
    assert.deepEqual(carta.map((s) => s.titulo), ["Pizzas", "Empanadas"]);
    assert.deepEqual(carta[0].items[0].productos.map((p) => p?.precio), [25000, 3600]);
    assert.deepEqual(carta[0].items[1].productos, [null, null]);
    db.raw.prepare("UPDATE products SET price_cents = 2700000 WHERE id = 'p-gde-muzza'").run();
    carta = await getCartaPublica(db, actors.anon);
    assert.equal(carta[0].items[0].productos[0]?.precio, 27000);
  });

  it("producto inactivo: la línea queda sin precio en la vista pública", async () => {
    await saveCarta(db, actors.admin, CARTA);
    db.raw.prepare("UPDATE products SET is_active = 0 WHERE id = 'p-porc-muzza'").run();
    const carta = await getCartaPublica(db, actors.anon);
    assert.equal(carta[0].items[0].productos[1], null);
    const admin = await getCartaAdmin(db, actors.admin);
    assert.equal(admin.secciones[0].items[0].productos[1]?.activo, false);
  });

  it("lista los productos visibles que no están en la carta", async () => {
    const admin = await saveCarta(db, actors.admin, CARTA);
    assert.deepEqual(admin.sinVincular.map((p) => p.id), ["p-on"]);
  });

  it("solo admin/sistema lee el editor y guarda", async () => {
    await assert.rejects(getCartaAdmin(db, actors.ana), ForbiddenError);
    await assert.rejects(saveCarta(db, actors.anon, CARTA), ForbiddenError);
    await assert.rejects(saveCarta(db, actors.rep1, CARTA), ForbiddenError);
  });

  it("guardar reemplaza la carta entera con el orden del arreglo", async () => {
    await saveCarta(db, actors.admin, CARTA);
    const reordered = { secciones: [CARTA.secciones[1], CARTA.secciones[0]] };
    const admin = await saveCarta(db, actors.admin, reordered);
    assert.deepEqual(admin.secciones.map((s) => s.id), ["s-empa", "s-pizzas"]);
  });

  it("rechaza productos inexistentes", async () => {
    const bad = { secciones: [{ ...CARTA.secciones[1], items: [{ ...CARTA.secciones[1].items[0], producto_id: "nope" }] }] };
    await assert.rejects(saveCarta(db, actors.admin, bad), CartaError);
  });

  it("la semilla de la carta del local corre y vincula por fudo_id", async () => {
    db.raw.prepare("UPDATE products SET fudo_id = 10, source = 'fudo' WHERE id = 'p-gde-muzza'").run();
    db.raw.exec(readFileSync(new URL("../d1/seeds/0015_carta_gambeta.sql", import.meta.url), "utf8"));
    const carta = await getCartaPublica(db, actors.anon);
    assert.equal(carta[0].titulo, "Pizzas");
    assert.equal(carta[0].items[0].productos[0]?.precio, 25000);
    assert.equal(carta[0].items[1].productos[0], null);
    assert.ok(carta.some((s) => s.titulo === "Bebidas"));
  });

  it("zod: ids repetidos, segundo producto sin segunda columna, campos extra y largos", () => {
    const dup = { secciones: [CARTA.secciones[0], { ...CARTA.secciones[1], id: "s-pizzas" }] };
    assert.equal(cartaInputSchema.safeParse(dup).success, false);
    const segunda = { secciones: [{ ...CARTA.secciones[1], items: [{ ...CARTA.secciones[1].items[0], producto_id_2: "p-porc-muzza" }] }] };
    assert.equal(cartaInputSchema.safeParse(segunda).success, false);
    assert.equal(cartaInputSchema.safeParse({ ...CARTA, extra: 1 }).success, false);
    assert.equal(cartaInputSchema.safeParse({ secciones: [{ ...CARTA.secciones[1], titulo: "x".repeat(81) }] }).success, false);
    assert.equal(cartaInputSchema.safeParse({ secciones: [{ ...CARTA.secciones[1], id: "con espacio" }] }).success, false);
    assert.equal(cartaInputSchema.safeParse(CARTA).success, true);
  });
});

describe("carta estructurada: PDF", () => {
  const text = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

  it("PDF válido con imágenes, fuentes embebidas y los títulos de sección", async () => {
    await saveCarta(db, actors.admin, CARTA);
    const pdf = renderCartaPdf({ secciones: seccionesDesdeCarta(await getCartaPublica(db, actors.anon)), footer: "Precios vigentes" });
    const s = text(pdf);
    assert.ok(s.startsWith("%PDF-1.4"));
    assert.ok(s.trimEnd().endsWith("%%EOF"));
    assert.match(s, /\(PIZZAS\) Tj/);
    assert.match(s, /\(EMPANADAS\) Tj/);
    assert.match(s, /\(\$25\.000\) Tj/);
    assert.match(s, /\(\$3\.500 c\/u\) Tj/);
    assert.match(s, /\/FontFile2/);
    assert.match(s, /\/DCTDecode/);
    assert.doesNotMatch(s, /\(OCULTA\)/);
    // xref apunta a objetos reales
    const startxref = Number(/startxref\n(\d+)/.exec(s)?.[1]);
    assert.equal(s.slice(startxref, startxref + 4), "xref");
  });

  it("pagina sola si la carta crece", () => {
    const items = Array.from({ length: 90 }, (_, i) => ({ nombre: `Plato ${i}`, precios: [1000] }));
    const pdf = text(renderCartaPdf({ secciones: [{ titulo: "Larga", columnas: [], estilo: "lista", items }] }));
    const count = Number(/\/Count (\d+)/.exec(pdf)?.[1]);
    assert.ok(count >= 3, `páginas: ${count}`);
  });

  it("respaldo por categorías cuando no hay carta", () => {
    const secciones = seccionesDesdeCategorias(
      [{ name: "Muzza", price: 100, category_id: "c1" }, { name: "Agua", price: 50, category_id: null }],
      [{ id: "c1", name: "Pizzas" }],
    );
    assert.deepEqual(secciones.map((s) => s.titulo), ["Pizzas", "Otros"]);
    assert.match(text(renderCartaPdf({ secciones })), /\(PIZZAS\) Tj/);
  });

  it("formato de precios y texto WinAnsi", () => {
    assert.equal(pesosCarta(25000), "$25.000");
    assert.equal(pesosCarta(3.5), "$3,50");
    assert.deepEqual(winAnsi("Fainá 🍕"), [70, 97, 105, 110, 0xe1, 32]);
  });
});

describe("carta estructurada: bot", () => {
  const pizzas: CartaSeccion = {
    titulo: "Pizzas", columnas: ["8 porciones", "Porción"], estilo: "lista", nota: null,
    items: [
      { nombre: "Muzzarella", nota: null, productos: [{ id: "g", price: 25000 }, { id: "p", price: 3600 }] },
      { nombre: "Pizza de cancha", nota: "salsa putanesca", productos: [null, null] },
    ],
  };
  const especiales: CartaSeccion = { titulo: "Pizzas especiales", columnas: ["8 porciones"], estilo: "lista", nota: null, items: [{ nombre: "Cuatro Quesos", nota: null, productos: [{ id: "q", price: 33000 }] }] };
  const empanadas: CartaSeccion = {
    titulo: "Empanadas", columnas: [], estilo: "gustos", nota: null,
    items: [{ nombre: "Carne Suave", nota: null, productos: [{ id: "e1", price: 3500 }] }, { nombre: "Pollo", nota: null, productos: [{ id: "e2", price: 3500 }] }],
  };
  const CARTA_BOT = [pizzas, especiales, empanadas];

  it("formatea secciones con columnas y empanadas con precio único", () => {
    assert.equal(formatCartaSeccion(pizzas), "🍕 Pizzas (8 porciones / Porción)\n• Muzzarella — $25.000 / $3.600\n• Pizza de cancha (salsa putanesca) — consultar / consultar");
    assert.equal(formatCartaSeccion(empanadas), "🥟 Empanadas — $3.500 c/u. Gustos: Carne Suave, Pollo.");
  });

  it("sinónimos: pizzas trae Pizzas y Pizzas especiales", () => {
    assert.deepEqual(cartaSectionsFor(CARTA_BOT, "las pizzas").map((s) => s.titulo), ["Pizzas", "Pizzas especiales"]);
    assert.deepEqual(cartaSectionsFor(CARTA_BOT, "empanada").map((s) => s.titulo), ["Empanadas"]);
    assert.equal(cartaCategoryForModel(CARTA_BOT, "promos", true), null);
  });

  it("con pedidos encendidos expone los product_id de cada columna", () => {
    const r = cartaCategoryForModel(CARTA_BOT, "pizzas", true) as { secciones: { productos: { id: string; name: string }[] }[] };
    assert.deepEqual(r.secciones[0].productos, [
      { id: "g", name: "Muzzarella (8 porciones)", price_text: "$25.000" },
      { id: "p", name: "Muzzarella (Porción)", price_text: "$3.600" },
    ]);
    const sinIds = cartaCategoryForModel(CARTA_BOT, "pizzas", false) as { secciones: Record<string, unknown>[] };
    assert.equal(sinIds.secciones[0].productos, undefined);
  });

  it("get_menu suma lo que no está en la carta (promos)", () => {
    const menu: MenuItem[] = [
      { id: "g", name: "Grande de muzzarella", description: null, price: 25000, category: "Platos Principales" },
      { id: "promo", name: "Promo finde", description: null, price: 36000, category: "Promos" },
    ];
    const r = cartaMenuForModel(CARTA_BOT, menu, true) as { carta: unknown[]; otras_categorias: { categoria: string }[] };
    assert.equal(r.carta.length, 3);
    assert.deepEqual(r.otras_categorias.map((c) => c.categoria), ["Promos"]);
  });

  it("repo D1 + herramientas: usa la carta y cae al menú de siempre si está vacía", async () => {
    const repo = d1BotRepo(db);
    const run = async (r: BotRepo, name: string, args: unknown) => {
      const tool = toolsFor("consulta_menu", r, { id: "c", phone: "1", clientId: null, displayName: null, humanTakeover: false }, settingsFromConfig({}), Date.now, {} as never).find((t) => t.name === name);
      assert.ok(tool, name);
      return tool.run(args) as Promise<Record<string, unknown>>;
    };
    const vacia = await run(repo, "get_categoria", { categoria: "pizzas" });
    assert.equal(vacia.secciones, undefined);
    await saveCarta(db, actors.admin, CARTA);
    const conCarta = await run(repo, "get_categoria", { categoria: "pizzas" });
    assert.match(JSON.stringify(conCarta.secciones), /Muzzarella — \$25\.000 \/ \$3\.600/);
    const menu = await run(repo, "get_menu", {});
    assert.ok(Array.isArray(menu.carta));
  });
});

describe("carta estructurada: rutas", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

  it("la API del editor exige admin, limita y valida con zod", () => {
    const src = read("src/app/api/admin/carta/route.ts");
    assert.match(src, /requireRole\("admin", req\)/);
    assert.match(src, /rateLimit\(/);
    assert.match(src, /cartaInputSchema\.safeParse/);
  });

  it("el PDF público mantiene la URL y tiene alias corto para el QR", () => {
    for (const p of ["src/app/api/public/carta.pdf/route.ts", "src/app/carta.pdf/route.ts"]) assert.match(read(p), /cartaPdfResponse\(req\)/);
    assert.match(read("src/lib/carta-pdf/handler.ts"), /stale-while-revalidate/);
    assert.match(read("src/app/cliente/_components/MenuSection.tsx"), /Ver carta \(PDF\)/);
  });
});
