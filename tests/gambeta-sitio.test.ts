import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./helpers/sqlite-d1.ts";
import { systemActor } from "../src/lib/data/actor.ts";

const { suggestLinks, parseAppName } = await import("../src/lib/gambeta/match.ts");
const { catalogSchema, promotionsSchema, envelopeSchema } = await import("../src/lib/gambeta/schemas.ts");
const { createGambetaClient, GambetaError, readGambetaApiKey } = await import("../src/lib/gambeta/client.ts");
const { putLinksSchema, validateAgainstSite } = await import("../src/lib/gambeta/links-input.ts");
const { isAllowedSitePhotoUrl, downloadSitePhoto, sitePhotoFor, SITE_PHOTO_HOST } = await import("../src/lib/gambeta/photos.ts");
const links = await import("../src/lib/data/site-links.ts");

const KEY = "lg_supersecreta_123456";

const v = (id: string, label: string, unit?: string) => ({ id, label, unit: unit ?? null });
const prod = (id: string, name: string, variants: ReturnType<typeof v>[], image_url: string | null = null) => ({
  id, name, description: "", image_url, active: true, variants, prices: [],
});
const catalogRaw = [
  {
    id: "c-salon", slug: "salon", name: "Cervezas y otras bebidas", channel_visibility: "salon", active: true,
    products: [prod("andes-lata-salon", "Andes lata", [])],
  },
  {
    id: "c-pizzas", slug: "pizzas", name: "Pizzas", channel_visibility: "ambos", active: true,
    products: [
      prod("muzza", "Muzzarella", [v("muzza-e", "Entera"), v("muzza-p", "Porción")], `https://${SITE_PHOTO_HOST}/products/muzza.jpg`),
      prod("fuga", "Fugazzeta rellena", [v("fuga-e", "Entera")]),
      prod("jym", "Jamón y morrón", [v("jym-e", "Entera"), v("jym-p", "Porción")]),
      prod("cancha", "Pizza de cancha", [v("cancha-e", "Entera"), v("cancha-p", "Porción")]),
      prod("4q", "Cuatro quesos", [v("4q-e", "Entera")]),
    ],
  },
  {
    id: "c-emp", slug: "empanadas", name: "Empanadas", channel_visibility: "ambos", active: true,
    products: [
      prod("e-pollo", "Pollo", [v("e-pollo-u", "unidad", "unidad")]),
      prod("e-carne", "Carne suave", [v("e-carne-u", "unidad", "unidad")]),
      prod("e-picante", "Carne picante", [v("e-picante-u", "unidad", "unidad")]),
    ],
  },
  {
    id: "c-beb", slug: "bebidas", name: "Bebidas", channel_visibility: "delivery", active: true,
    products: [
      prod("andes-lata-deli", "Andes lata", []),
      prod("andes-litro", "Andes litro", []),
      prod("stella", "Stella litro", []),
      prod("agua", "Agua con/sin gas", []),
      prod("pepsi-ch", "Gaseosa chica, línea Pepsi", []),
      prod("tostado", "Tostado de JyQ, pan de miga", []),
      prod("medio", "Medio tostado de JyQ", []),
    ],
  },
];
const promosRaw = [{ id: "bombazo", slug: "bombazo", name: "Bombazo al ángulo", price: 20000, active: true, items: [] }];

const catalog = catalogSchema.parse(catalogRaw);
const promos = promotionsSchema.parse(promosRaw);

function suggest(name: string, categoryName: string | null = "Pizzas") {
  const [s] = suggestLinks([{ id: "x", name, categoryName }], catalog, promos);
  return s;
}

describe("sugerencias de vínculo", () => {
  it("Grande de muzzarella → Muzzarella / Entera, alta", () => {
    const s = suggest("Grande de muzzarella");
    assert.deepEqual([s.siteId, s.siteVariantId, s.confidence, s.kind], ["muzza", "muzza-e", "alta", "product"]);
  });
  it("Porcion Muzzarella → Muzzarella / Porción", () => {
    const s = suggest("Porcion Muzzarella");
    assert.deepEqual([s.siteId, s.siteVariantId], ["muzza", "muzza-p"]);
  });
  it("Empanada de pollo → Pollo / unidad", () => {
    const s = suggest("Empanada de pollo", "Empanadas");
    assert.deepEqual([s.siteId, s.siteVariantId, s.confidence], ["e-pollo", "e-pollo-u", "alta"]);
    assert.equal(suggest("Empanada Carne Picante", "Empanadas").siteId, "e-picante");
    assert.equal(suggest("Empanada de carne", "Empanadas").siteId, "e-carne");
  });
  it("Grande Jamón y morrones → Jamón y morrón / Entera", () => {
    const s = suggest("Grande Jamón y morrones");
    assert.deepEqual([s.siteId, s.siteVariantId], ["jym", "jym-e"]);
  });
  it("sinónimos de pizzas y bebidas", () => {
    assert.equal(suggest("Grande de Fugazzeta").siteId, "fuga");
    assert.equal(suggest("Porcion de cancha").siteVariantId, "cancha-p");
    assert.equal(suggest("Grande Cuatro quesos").siteVariantId, "4q-e");
    assert.equal(suggest("Pepsi Chica", "Bebidas").siteId, "pepsi-ch");
    assert.equal(suggest("Agua con gas", "Bebidas").siteId, "agua");
    assert.equal(suggest("Stella Artois 1L", "Bebidas").siteId, "stella");
    assert.equal(suggest("Tostado jamón y queso", "Bebidas").siteId, "tostado");
    assert.equal(suggest("Tostado de Jamón y Queso 1/2 porción", "Bebidas").siteId, "medio");
  });
  it("Bombazo Al Angulo (…) → promoción", () => {
    const s = suggest("Bombazo Al Angulo (Gde Muzza + 6 Empa + Bebida)", "Promos");
    assert.deepEqual([s.kind, s.siteId, s.siteVariantId, s.confidence], ["promotion", "bombazo", null, "alta"]);
  });
  it("Andes Rubia (Lata 473) → Andes lata de la categoría delivery", () => {
    const s = suggest("Andes Rubia (Lata 473)", "Bebidas");
    assert.equal(s.siteId, "andes-lata-deli");
    assert.equal(suggest("Andes Rubia 1L", "Bebidas").siteId, "andes-litro");
  });
  it("sin par → sin sugerencia", () => {
    assert.equal(suggest("Medialuna de manteca", "Panadería"), undefined);
    assert.equal(suggest("Grande espinaca y salsa blanca"), undefined);
  });
  it("dos productos al mismo destino bajan a media", () => {
    const out = suggestLinks(
      [{ id: "a", name: "Grande de muzzarella" }, { id: "b", name: "Grande Muzzarella" }],
      catalog, promos,
    );
    assert.deepEqual(out.map((s) => s.confidence), ["media", "media"]);
  });
  it("parseAppName saca prefijos", () => {
    assert.deepEqual(parseAppName("Porcion de cancha"), { core: "pizza de cancha", hint: "porcion" });
  });
});

describe("esquemas", () => {
  it("toleran campos extra y faltantes", () => {
    const [c] = catalogSchema.parse([{ id: "1", name: "X", nuevo: 1, products: [{ id: "p", name: "P", otro: true, prices: [{ channel: "salon", amount: null }] }] }]);
    assert.equal(c.products[0].variants.length, 0);
    assert.equal(c.products[0].prices[0].amount, null);
  });
  it("sobre success:false", () => {
    const r = envelopeSchema(catalogSchema).parse({ success: false, error: "no" });
    assert.equal(r.success, false);
  });
  it("rechaza lo que no es un sobre", () => {
    assert.equal(envelopeSchema(catalogSchema).safeParse({ data: [] }).success, false);
  });
});

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
}

describe("cliente del sitio", () => {
  it("lee la carta y manda la clave solo en Authorization", async () => {
    let seen: { url: string; auth: string | null } | null = null;
    const client = createGambetaClient({
      apiKey: KEY,
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen = { url, auth: new Headers(init.headers).get("authorization") };
        return new Response(JSON.stringify({ success: true, data: catalogRaw }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    const data = await client.getCatalog();
    assert.equal(data.length, 4);
    assert.equal(seen!.url, "https://www.la-gambeta.com/api/v1/catalog?all=1");
    assert.equal(seen!.auth, `Bearer ${KEY}`);
    assert.ok(!seen!.url.includes(KEY));
  });

  it("los errores nunca incluyen la clave", async () => {
    const cases: Array<[typeof fetch, string]> = [
      [fakeFetch(401, { success: false, error: `clave ${KEY} inválida` }), "rechazado"],
      [fakeFetch(500, { success: false }), "http"],
      [fakeFetch(200, { success: true, data: "raro" }), "formato"],
      [(async () => { throw new Error(`fallo con ${KEY}`); }) as unknown as typeof fetch, "red"],
      [(async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }) as unknown as typeof fetch, "timeout"],
    ];
    for (const [fetchImpl, code] of cases) {
      const client = createGambetaClient({ apiKey: KEY, fetchImpl });
      await assert.rejects(client.getCatalog(), (err: unknown) => {
        assert.ok(err instanceof GambetaError);
        assert.equal(err.code, code);
        assert.ok(!err.message.includes(KEY), err.message);
        assert.ok(!JSON.stringify(err).includes(KEY));
        return true;
      });
    }
  });

  it("sin clave no hace ningún pedido", async () => {
    let called = false;
    const client = createGambetaClient({ apiKey: "", fetchImpl: (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch });
    await assert.rejects(client.getPromotions(), (err: unknown) => err instanceof GambetaError && err.code === "sin_clave");
    assert.equal(called, false);
    assert.equal(readGambetaApiKey({}), null);
    assert.equal(readGambetaApiKey({ LA_GAMBETA_API_KEY: " k " }), "k");
  });
});

describe("guardado de vínculos: validación", () => {
  const ok = (body: unknown) => putLinksSchema.safeParse(body);
  it("exige forma estricta", () => {
    assert.equal(ok({ links: [] }).success, false);
    assert.equal(ok({ links: [{ appProductId: "a", site: null, extra: 1 }] }).success, false);
    assert.equal(ok({ links: [{ appProductId: "a", site: null }, { appProductId: "a", site: null }] }).success, false);
    assert.equal(ok({ links: [{ appProductId: "a", site: { kind: "otro", siteId: "x" } }] }).success, false);
    assert.ok(ok({ links: [{ appProductId: "a", site: { kind: "product", siteId: "muzza", siteVariantId: "muzza-e" } }] }).success);
  });
  it("valida contra la carta del sitio", () => {
    const check = (site: unknown) => {
      const parsed = putLinksSchema.parse({ links: [{ appProductId: "a", site }] });
      return validateAgainstSite(parsed, catalog, promos);
    };
    assert.equal(check({ kind: "product", siteId: "muzza", siteVariantId: "muzza-e" }).ok, true);
    assert.equal(check({ kind: "product", siteId: "no-existe" }).ok, false);
    assert.equal(check({ kind: "product", siteId: "muzza", siteVariantId: "otra" }).ok, false);
    assert.equal(check({ kind: "promotion", siteId: "bombazo" }).ok, true);
    assert.equal(check({ kind: "promotion", siteId: "bombazo", siteVariantId: "x" }).ok, false);
    assert.equal(check({ kind: "promotion", siteId: "zzz" }).ok, false);
    assert.equal(check(null).ok, true);
  });
});

describe("fotos del sitio", () => {
  it("solo https y el host exacto", () => {
    assert.ok(isAllowedSitePhotoUrl(`https://${SITE_PHOTO_HOST}/a.jpg`));
    for (const bad of [`http://${SITE_PHOTO_HOST}/a.jpg`, "https://evil.com/a.jpg", `https://${SITE_PHOTO_HOST}.evil.com/a.jpg`,
      `https://user@${SITE_PHOTO_HOST}/a.jpg`, `https://${SITE_PHOTO_HOST}:8443/a.jpg`, "no es url"]) {
      assert.equal(isAllowedSitePhotoUrl(bad), false, bad);
    }
  });
  it("descarga con tipo y tamaño controlados", async () => {
    const url = `https://${SITE_PHOTO_HOST}/a.png`;
    const mk = (type: string, size: number, len?: string) =>
      (async () => new Response(new Uint8Array(size), { status: 200, headers: { "content-type": type, ...(len ? { "content-length": len } : {}) } })) as unknown as typeof fetch;
    assert.equal((await downloadSitePhoto(url, mk("image/png", 10))).contentType, "image/png");
    await assert.rejects(downloadSitePhoto(url, mk("text/html", 10)));
    await assert.rejects(downloadSitePhoto(url, mk("image/png", 10, String(6 * 1024 * 1024))));
    await assert.rejects(downloadSitePhoto(url, mk("image/png", 0)));
    await assert.rejects(downloadSitePhoto("https://evil.com/a.png", mk("image/png", 10)));
  });
  it("busca la foto del producto o de la promoción", () => {
    assert.match(sitePhotoFor({ kind: "product", siteId: "muzza" }, catalog, promos) ?? "", /muzza\.jpg$/);
    assert.equal(sitePhotoFor({ kind: "product", siteId: "fuga" }, catalog, promos), null);
    assert.equal(sitePhotoFor({ kind: "promotion", siteId: "bombazo" }, catalog, promos), null);
  });
});

describe("site_links (D1)", () => {
  const actor = systemActor("test");
  const seed = (db: ReturnType<typeof createTestDb>, id: string, name: string, image = "") =>
    db.raw.prepare("INSERT INTO products (id, name, price_cents, image_url) VALUES (?, ?, 1000, ?)").run(id, name, image);

  it("guarda varios productos al mismo destino, actualiza y quita", async () => {
    const db = createTestDb();
    seed(db, "p1", "Grande de muzzarella");
    seed(db, "p2", "Porcion Muzzarella");
    await links.saveSiteLinks(db, actor, [
      { appProductId: "p1", link: { kind: "product", siteId: "muzza", siteVariantId: "muzza-e" } },
      { appProductId: "p2", link: { kind: "product", siteId: "muzza", siteVariantId: "muzza-p" } },
    ], "u1");
    assert.equal((await links.listSiteLinks(db, actor)).length, 2);
    const r = await links.saveSiteLinks(db, actor, [
      { appProductId: "p1", link: null },
      { appProductId: "p2", link: { kind: "product", siteId: "otro", siteVariantId: null } },
    ], "u1");
    assert.deepEqual(r, { saved: 1, removed: 1 });
    const left = await links.listSiteLinks(db, actor);
    assert.deepEqual(left.map((l) => [l.appProductId, l.siteId, l.linkedBy]), [["p2", "otro", "u1"]]);
  });

  it("rechaza todo el lote si un producto no existe y borra el vínculo con el producto", async () => {
    const db = createTestDb();
    seed(db, "p1", "A");
    await assert.rejects(
      links.saveSiteLinks(db, actor, [
        { appProductId: "p1", link: { kind: "promotion", siteId: "s", siteVariantId: null } },
        { appProductId: "nope", link: { kind: "promotion", siteId: "s", siteVariantId: null } },
      ], null),
      links.SiteLinkError,
    );
    assert.equal((await links.listSiteLinks(db, actor)).length, 0);
    await links.saveSiteLinks(db, actor, [{ appProductId: "p1", link: { kind: "promotion", siteId: "s", siteVariantId: null } }], null);
    db.raw.prepare("DELETE FROM products WHERE id = 'p1'").run();
    assert.equal((await links.listSiteLinks(db, actor)).length, 0);
  });

  it("la foto solo se guarda si no había ninguna", async () => {
    const db = createTestDb();
    seed(db, "p1", "A");
    seed(db, "p2", "B", "https://x/foto.jpg");
    assert.equal(await links.setProductPhotoIfEmpty(db, actor, "p1", "https://nuestro/a.jpg"), true);
    assert.equal(await links.setProductPhotoIfEmpty(db, actor, "p2", "https://nuestro/b.jpg"), false);
    const rows = await links.listAppProductsForSite(db, actor);
    assert.deepEqual(rows.map((r) => [r.id, r.hasPhoto]), [["p1", true], ["p2", true]]);
  });

  it("solo staff", async () => {
    const db = createTestDb();
    await assert.rejects(links.listSiteLinks(db, { kind: "anon" }));
  });
});
