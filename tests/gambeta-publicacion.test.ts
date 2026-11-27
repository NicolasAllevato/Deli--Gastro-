import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTestDb } from "./helpers/sqlite-d1.ts";
import { systemActor } from "../src/lib/data/actor.ts";

const { catalogSchema, promotionsSchema } = await import("../src/lib/gambeta/schemas.ts");
const { planPublish, formatPesos } = await import("../src/lib/gambeta/publish-plan.ts");
const { runPublish } = await import("../src/lib/gambeta/publish.ts");
const { createGambetaClient } = await import("../src/lib/gambeta/client.ts");
const { createPublishStore } = await import("../src/lib/data/site-publish.ts");
const { createProductSchema, createProductOnSite, cleanProductName, buildCreateBody, CreateProductError } = await import(
  "../src/lib/gambeta/create-product.ts"
);
const { isAllowedAppPhotoUrl } = await import("../src/lib/gambeta/photos.ts");

const KEY = "lg_supersecreta_123456";
const BASE = "https://pub-app.r2.dev";
const price = (id: string, variant_id: string | null, channel: string, amount: number) => ({ id, variant_id, channel, amount, active: true });

function siteCatalog(overrides: { muzzaActive?: boolean } = {}) {
  return catalogSchema.parse([
    {
      id: "c-pizzas", name: "Pizzas", channel_visibility: "ambos", active: true,
      products: [
        {
          id: "muzza", name: "Muzzarella", active: overrides.muzzaActive ?? true, image_url: null,
          variants: [{ id: "muzza-e", label: "Entera" }, { id: "muzza-p", label: "Porción" }],
          prices: [
            price("p1", "muzza-e", "salon", 25000), price("p2", "muzza-e", "delivery", 27000),
            price("p3", "muzza-p", "salon", 4000),
          ],
        },
        { id: "fuga", name: "Fugazzeta", active: true, variants: [{ id: "fuga-e", label: "Entera" }], prices: [] },
      ],
    },
    {
      id: "c-salon", name: "Salón", channel_visibility: "salon", active: true,
      products: [{ id: "sopa", name: "Sopa inglesa", active: true, variants: [], prices: [price("s1", null, "salon", 5000)] }],
    },
  ]);
}
const site = siteCatalog();
const promos = promotionsSchema.parse([{ id: "bombazo", name: "Bombazo", price: 20000, active: true, image_url: null, items: [] }]);

const app = (id: string, priceCents: number, extra: Partial<{ imageUrl: string; isActive: boolean; name: string }> = {}) => ({
  id, name: extra.name ?? id, priceCents, imageUrl: extra.imageUrl ?? "", isActive: extra.isActive ?? true,
});
const link = (appProductId: string, siteId: string, siteVariantId: string | null, extra: { kind?: "product" | "promotion"; pushed?: string | null } = {}) => ({
  appProductId, siteId, siteVariantId, kind: extra.kind ?? ("product" as const), pushedImageUrl: extra.pushed ?? null,
});

describe("planPublish: precios", () => {
  it("cambia el precio en todos los canales de la variante y conserva ids", () => {
    const { ops } = planPublish({ appProducts: [app("a", 2_600_000)], links: [link("a", "muzza", "muzza-e")], catalog: site, promotions: promos });
    assert.equal(ops.length, 1);
    const prices = ops[0].body.prices as Array<{ id: string; amount: number; variant_id: string }>;
    assert.deepEqual(prices.filter((p) => p.variant_id === "muzza-e").map((p) => [p.id, p.amount]), [["p1", 26000], ["p2", 26000]]);
    assert.match(ops[0].changes[0], /Muzzarella · Entera: \$25\.000 \/ \$27\.000 → \$26\.000/);
  });

  it("no toca las otras variantes (las manda tal cual porque el PUT reemplaza la lista)", () => {
    const { ops } = planPublish({ appProducts: [app("a", 2_600_000)], links: [link("a", "muzza", "muzza-e")], catalog: site, promotions: promos });
    const prices = ops[0].body.prices as Array<{ id: string; amount: number }>;
    assert.equal(prices.length, 3);
    assert.equal(prices.find((p) => p.id === "p3")!.amount, 4000);
  });

  it("agrega el precio faltante según la visibilidad de la categoría", () => {
    const both = planPublish({ appProducts: [app("a", 1_200_000)], links: [link("a", "fuga", "fuga-e")], catalog: site, promotions: promos });
    const added = both.ops[0].body.prices as Array<{ channel: string; amount: number; variant_id: string }>;
    assert.deepEqual(added.map((p) => [p.channel, p.amount, p.variant_id]), [["salon", 12000, "fuga-e"], ["delivery", 12000, "fuga-e"]]);
  });

  it("producto de salón sin variante: precio solo en salón y sin variant_id", () => {
    const cat = catalogSchema.parse([{ id: "c", name: "S", channel_visibility: "salon", products: [{ id: "x", name: "X", active: true, variants: [], prices: [] }] }]);
    const { ops } = planPublish({ appProducts: [app("a", 100_000)], links: [link("a", "x", null)], catalog: cat, promotions: [] });
    assert.deepEqual(ops[0].body.prices, [{ variant_id: null, channel: "salon", amount: 1000, active: true }]);
  });

  it("sin cambios, no hay operación", () => {
    const plan = planPublish({
      appProducts: [app("a", 2_500_000), app("b", 400_000)],
      links: [link("a", "muzza", "muzza-e"), link("b", "muzza", "muzza-p")],
      catalog: catalogSchema.parse([{ id: "c", name: "P", channel_visibility: "ambos", products: [
        { id: "muzza", name: "Muzzarella", active: true, variants: [{ id: "muzza-e", label: "Entera" }, { id: "muzza-p", label: "Porción" }],
          prices: [price("p1", "muzza-e", "salon", 25000), price("p2", "muzza-e", "delivery", 25000), price("p3", "muzza-p", "salon", 4000), price("p4", "muzza-p", "delivery", 4000)] },
      ] }]),
      promotions: [],
    });
    assert.deepEqual(plan.ops, []);
  });

  it("precio 0 en la app no se toca", () => {
    const { ops } = planPublish({ appProducts: [app("a", 0)], links: [link("a", "muzza", "muzza-e")], catalog: site, promotions: promos });
    assert.deepEqual(ops, []);
  });

  it("redondea a pesos enteros", () => {
    assert.equal(formatPesos(26000), "$26.000");
    const { ops } = planPublish({ appProducts: [app("a", 2_600_049)], links: [link("a", "muzza", "muzza-e")], catalog: site, promotions: promos });
    assert.equal((ops[0].body.prices as Array<{ amount: number }>)[0].amount, 26000);
  });
});

describe("planPublish: activo, fotos, promos y guardarraíl", () => {
  it("oculta si todos los vinculados están inactivos y muestra si alguno está activo", () => {
    const off = planPublish({
      appProducts: [app("a", 2_500_000, { isActive: false }), app("b", 400_000, { isActive: false })],
      links: [link("a", "muzza", "muzza-e"), link("b", "muzza", "muzza-p")], catalog: site, promotions: promos,
    });
    assert.equal(off.ops[0].body.active, false);
    assert.ok(off.ops[0].changes.includes("Ocultar: Muzzarella"));
    const mixed = planPublish({
      appProducts: [app("a", 2_500_000, { isActive: false }), app("b", 400_000)],
      links: [link("a", "muzza", "muzza-e"), link("b", "muzza", "muzza-p")], catalog: siteCatalog({ muzzaActive: false }), promotions: promos,
    });
    assert.equal(mixed.ops[0].body.active, true);
    assert.ok(mixed.ops[0].changes.includes("Mostrar: Muzzarella"));
  });

  it("el guardarraíl frena desactivaciones masivas (>30 %) y avisa", () => {
    // 3 productos activos en el sitio (muzza, fuga, sopa) + 1 promo = 4; apagar 2 es 50 %.
    const plan = planPublish({
      appProducts: [app("a", 2_500_000, { isActive: false }), app("b", 500_000, { isActive: false })],
      links: [link("a", "muzza", "muzza-e"), link("b", "sopa", null)], catalog: site, promotions: promos,
    });
    assert.equal(plan.ops.some((o) => o.deactivates || "active" in o.body), false);
    assert.equal(plan.warnings.length, 1);
    assert.match(plan.warnings[0], /30 %/);
  });

  it("una sola desactivación bajo el tope pasa", () => {
    const many = catalogSchema.parse([{ id: "c", name: "P", channel_visibility: "ambos", products: Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, active: true, variants: [], prices: [] })) }]);
    const plan = planPublish({ appProducts: [app("a", 0, { isActive: false })], links: [link("a", "p0", null)], catalog: many, promotions: [] });
    assert.equal(plan.warnings.length, 0);
    assert.equal(plan.ops[0].body.active, false);
  });

  it("la foto se sube solo si cambió, y prefiere la variante Entera", () => {
    const url = (n: string) => `${BASE}/${n}.jpg`;
    const first = planPublish({
      appProducts: [app("a", 2_500_000, { imageUrl: url("entera") }), app("b", 400_000, { imageUrl: url("porcion") })],
      links: [link("b", "muzza", "muzza-p"), link("a", "muzza", "muzza-e")], catalog: site, promotions: promos,
    });
    const photoOp = first.ops.find((o) => o.photo)!;
    assert.equal(photoOp.photo!.sourceUrl, url("entera"));
    assert.deepEqual(photoOp.photo!.appProductIds, ["a"]);
    assert.ok(photoOp.changes.includes("Foto nueva: Muzzarella"));
    const synced = planPublish({
      appProducts: [app("a", 2_500_000, { imageUrl: url("entera") })],
      links: [link("a", "muzza", "muzza-e", { pushed: url("entera") })],
      catalog: catalogSchema.parse([{ id: "c", name: "P", channel_visibility: "ambos", products: [
        { id: "muzza", name: "Muzzarella", active: true, variants: [{ id: "muzza-e", label: "Entera" }],
          prices: [price("p1", "muzza-e", "salon", 25000), price("p2", "muzza-e", "delivery", 25000)] }] }]),
      promotions: [],
    });
    assert.deepEqual(synced.ops, []);
  });

  it("promociones: precio, activo y foto", () => {
    const { ops } = planPublish({
      appProducts: [app("pr", 2_200_000, { isActive: false, imageUrl: `${BASE}/pr.png` })],
      links: [link("pr", "bombazo", null, { kind: "promotion" })], catalog: site, promotions: promos,
    });
    assert.equal(ops.length, 1);
    assert.equal(ops[0].kind, "promotion");
    assert.equal(ops[0].body.price, 22000);
    assert.equal(ops[0].body.active, false);
    assert.equal(ops[0].photo!.folder, "promos");
  });

  it("onlyAppProductIds deja solo las operaciones de esos productos", () => {
    const input = {
      appProducts: [app("a", 2_600_000), app("c", 1_200_000)],
      links: [link("a", "muzza", "muzza-e"), link("c", "fuga", "fuga-e")], catalog: site, promotions: promos,
    };
    assert.equal(planPublish(input).ops.length, 2);
    assert.deepEqual(planPublish({ ...input, onlyAppProductIds: ["c"] }).ops.map((o) => o.siteId), ["fuga"]);
  });
});

// ---- Ejecutor con cliente y base falsos ----

interface Call { method: string; path: string; body?: unknown; form?: boolean }

function fakeSite(opts: { failPut?: string; failMedia?: boolean } = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = String(url).replace("https://www.la-gambeta.com/api/v1", "");
    const method = init.method ?? "GET";
    const isForm = init.body instanceof FormData;
    calls.push({ method, path, form: isForm, body: isForm || init.body === undefined ? undefined : JSON.parse(String(init.body)) });
    const json = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status });
    if (path.startsWith("/catalog")) return json(JSON.parse(JSON.stringify(site)));
    if (path.startsWith("/promotions") && method === "GET") return json([]);
    if (path === "/media") return opts.failMedia ? new Response(JSON.stringify({ success: false, error: "no" }), { status: 500 }) : json({ url: "https://www.la-gambeta.com/media/nueva.jpg", key: "k" });
    if (method === "PUT" && opts.failPut && path.endsWith(`/${opts.failPut}`)) return new Response(JSON.stringify({ success: false, error: `fallo con ${KEY}` }), { status: 500 });
    if (path === "/products" && method === "POST") return json({ id: "nuevo", name: "X", variants: [{ id: "nv", label: "Entera" }], prices: [] });
    return json({});
  }) as unknown as typeof fetch;
  return { calls, client: createGambetaClient({ apiKey: KEY, fetchImpl }) };
}

const photoFetch = (async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } })) as unknown as typeof fetch;

function setup(opts: Parameters<typeof fakeSite>[0] = {}) {
  const db = createTestDb();
  const store = createPublishStore(db, systemActor("test"));
  const site = fakeSite(opts);
  const addProduct = (id: string, cents: number, image = "", active = 1) =>
    db.raw.prepare("INSERT INTO products (id, name, price_cents, image_url, is_active) VALUES (?, ?, ?, ?, ?)").run(id, id, cents, image, active);
  const addLink = (id: string, siteId: string, variant: string | null) =>
    db.raw.prepare("INSERT INTO site_links (app_product_id, kind, site_id, site_variant_id) VALUES (?, 'product', ?, ?)").run(id, siteId, variant);
  const deps = { store, client: site.client, fetchImpl: photoFetch, publicBaseUrl: BASE, now: () => new Date("2026-11-26T12:00:00Z"), newId: () => "run1" };
  return { db, store, site, addProduct, addLink, deps };
}

describe("runPublish", () => {
  it("sube la foto (POST /media) antes del PUT, guarda estado y registra la corrida", async () => {
    const t = setup();
    t.addProduct("a", 2_600_000, `${BASE}/a.jpg`);
    t.addLink("a", "muzza", "muzza-e");
    const out = await runPublish(t.deps, { trigger: "manual" });
    assert.equal(out.status, "ok");
    const seq = t.site.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`);
    assert.deepEqual(seq, ["POST /media", "PUT /products/muzza"]);
    assert.equal(t.site.calls.find((c) => c.path === "/media")!.form, true);
    const put = t.site.calls.find((c) => c.method === "PUT")!.body as { image_url: string; prices: unknown[] };
    assert.equal(put.image_url, "https://www.la-gambeta.com/media/nueva.jpg");
    const row = t.db.raw.prepare("SELECT last_pushed_at, last_push_error, pushed_image_url FROM site_links").get() as Record<string, string | null>;
    assert.equal(row.last_pushed_at, "2026-11-26T12:00:00.000Z");
    assert.equal(row.last_push_error, null);
    assert.equal(row.pushed_image_url, `${BASE}/a.jpg`);
    const run = t.db.raw.prepare("SELECT trigger, ok, finished_at, summary FROM site_publish_runs").get() as Record<string, string | number>;
    assert.equal(run.trigger, "manual");
    assert.equal(run.ok, 1);
    assert.ok(run.finished_at);
    assert.equal(JSON.parse(String(run.summary)).ok, 1);
    // Segunda corrida: ya está al día, no vuelve a subir la foto.
    t.site.calls.length = 0;
    const again = await runPublish({ ...t.deps, newId: () => "run2", now: () => new Date("2026-11-26T12:30:00Z") }, { trigger: "cron" });
    assert.equal(again.status, "ok");
    assert.ok(!t.site.calls.some((c) => c.path === "/media"));
  });

  it("un error en un ítem no corta el resto y no filtra la clave", async () => {
    const t = setup({ failPut: "muzza" });
    t.addProduct("a", 2_600_000);
    t.addProduct("b", 1_200_000);
    t.addLink("a", "muzza", "muzza-e");
    t.addLink("b", "fuga", "fuga-e");
    const out = await runPublish(t.deps, { trigger: "cron" });
    assert.equal(out.status, "con_errores");
    assert.ok(t.site.calls.some((c) => c.method === "PUT" && c.path.endsWith("/fuga")));
    const rows = t.db.raw.prepare("SELECT app_product_id AS id, last_push_error AS e, last_pushed_at AS at FROM site_links ORDER BY id").all() as Array<{ id: string; e: string | null; at: string | null }>;
    assert.ok(rows[0].e && rows[0].at === null);
    assert.ok(!rows[0].e!.includes(KEY));
    assert.equal(rows[1].e, null);
    const run = t.db.raw.prepare("SELECT ok, summary FROM site_publish_runs").get() as { ok: number; summary: string };
    assert.equal(run.ok, 0);
    assert.ok(!run.summary.includes(KEY));
  });

  it("si falla la foto igual publica el precio y lo avisa", async () => {
    const t = setup({ failMedia: true });
    t.addProduct("a", 2_600_000, `${BASE}/a.jpg`);
    t.addLink("a", "muzza", "muzza-e");
    const out = await runPublish(t.deps, { trigger: "manual" });
    assert.equal(out.status, "con_errores");
    const put = t.site.calls.find((c) => c.method === "PUT")!.body as Record<string, unknown>;
    assert.ok("prices" in put && !("image_url" in put));
    const row = t.db.raw.prepare("SELECT last_push_error AS e, pushed_image_url AS p FROM site_links").get() as { e: string; p: string | null };
    assert.match(row.e, /^Foto:/);
    assert.equal(row.p, null);
  });

  it("rechaza fotos que no son de nuestro bucket", async () => {
    const t = setup();
    t.addProduct("a", 2_500_000, "https://evil.example.com/a.jpg");
    t.addLink("a", "muzza", "muzza-e");
    await runPublish(t.deps, { trigger: "manual" });
    assert.ok(!t.site.calls.some((c) => c.path === "/media"));
    assert.equal(isAllowedAppPhotoUrl(`${BASE}/x.jpg`, BASE), true);
    assert.equal(isAllowedAppPhotoUrl("http://pub-app.r2.dev/x.jpg", BASE), false);
    assert.equal(isAllowedAppPhotoUrl("data:image/png;base64,AA", BASE), false);
    assert.equal(isAllowedAppPhotoUrl(`${BASE}/x.jpg`, null), false);
  });

  it("evita corridas superpuestas, pero ignora las colgadas hace más de 5 minutos", async () => {
    const t = setup();
    t.addProduct("a", 2_600_000);
    t.addLink("a", "muzza", "muzza-e");
    await t.store.startRun("viva", "cron", "2026-11-26T11:58:00.000Z");
    assert.deepEqual(await runPublish(t.deps, { trigger: "manual" }), { status: "ocupado" });
    assert.equal(t.site.calls.length, 0);
    t.db.raw.prepare("UPDATE site_publish_runs SET started_at = '2026-11-26T11:00:00.000Z'").run();
    assert.equal((await runPublish(t.deps, { trigger: "manual" })).status, "ok");
  });

  it("sin clave o sin vínculos no hace nada ni registra corrida", async () => {
    const t = setup();
    const noKey = { ...t.deps, client: createGambetaClient({ apiKey: "" }) };
    assert.deepEqual(await runPublish(noKey, { trigger: "cron" }), { status: "sin_clave" });
    t.addProduct("a", 100);
    assert.deepEqual(await runPublish(t.deps, { trigger: "cambio", onlyAppProductIds: ["a"] }), { status: "sin_vinculos" });
    assert.equal((t.db.raw.prepare("SELECT COUNT(*) AS n FROM site_publish_runs").get() as { n: number }).n, 0);
  });

  it("respeta el tope de operaciones por corrida", async () => {
    const t = setup();
    t.addProduct("a", 2_600_000);
    t.addProduct("b", 1_200_000);
    t.addLink("a", "muzza", "muzza-e");
    t.addLink("b", "fuga", "fuga-e");
    const out = await runPublish({ ...t.deps, maxOps: 1 }, { trigger: "cron" });
    assert.equal(out.status === "ok" && out.summary.pending, 1);
    assert.equal(t.site.calls.filter((c) => c.method === "PUT").length, 1);
  });

  it("si el sitio no responde, registra la corrida como fallida", async () => {
    const t = setup();
    t.addProduct("a", 2_600_000);
    t.addLink("a", "muzza", "muzza-e");
    const broken = createGambetaClient({ apiKey: KEY, fetchImpl: (async () => { throw new Error(`caído ${KEY}`); }) as unknown as typeof fetch });
    const out = await runPublish({ ...t.deps, client: broken }, { trigger: "cron" });
    assert.equal(out.status, "error");
    const run = t.db.raw.prepare("SELECT ok, summary FROM site_publish_runs").get() as { ok: number; summary: string };
    assert.equal(run.ok, 0);
    assert.ok(!run.summary.includes(KEY));
  });
});

describe("cliente: multipart", () => {
  it("POST /media manda FormData sin content-type manual y sin filtrar la clave", async () => {
    let seen: { headers: Headers; body: unknown; url: string } | null = null;
    const client = createGambetaClient({
      apiKey: KEY,
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen = { headers: new Headers(init.headers), body: init.body, url };
        return new Response(JSON.stringify({ success: true, data: { url: "https://x.test/a.jpg", key: "k" } }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    const r = await client.uploadMedia({ bytes: new Uint8Array([1, 2]).buffer, contentType: "image/png", filename: "foto.png" }, "products");
    assert.equal(r.url, "https://x.test/a.jpg");
    assert.ok(seen!.body instanceof FormData);
    const form = seen!.body as FormData;
    assert.equal(form.get("folder"), "products");
    assert.ok(form.get("file") instanceof Blob);
    assert.equal(seen!.headers.get("content-type"), null);
    assert.equal(seen!.headers.get("authorization"), `Bearer ${KEY}`);
    assert.ok(!seen!.url.includes(KEY));
  });

  it("los errores de escritura no incluyen la clave", async () => {
    const client = createGambetaClient({
      apiKey: KEY,
      fetchImpl: (async () => new Response(JSON.stringify({ success: false, error: `bad ${KEY}` }), { status: 400 })) as unknown as typeof fetch,
    });
    await assert.rejects(client.putProduct("x", { active: true }), (e: unknown) => e instanceof Error && !e.message.includes(KEY));
    await assert.rejects(client.uploadMedia({ bytes: new ArrayBuffer(1), contentType: "image/png", filename: "a.png" }, "promos"), (e: unknown) => e instanceof Error && !e.message.includes(KEY));
  });
});

describe("crear producto en el sitio", () => {
  it("valida la forma del pedido", () => {
    assert.equal(createProductSchema.safeParse({ appProductId: "a", siteCategoryId: "c" }).success, true);
    assert.equal(createProductSchema.safeParse({ appProductId: "a" }).success, false);
    assert.equal(createProductSchema.safeParse({ appProductId: "a", siteCategoryId: "c", extra: 1 }).success, false);
    assert.equal(createProductSchema.safeParse({ appProductId: "", siteCategoryId: "c" }).success, false);
  });

  it("limpia los prefijos de Fudo y arma precios por canal", () => {
    assert.equal(cleanProductName("Grande de muzzarella"), "Muzzarella");
    assert.equal(cleanProductName("Porción Calabresa"), "Calabresa");
    assert.equal(cleanProductName("Coca Cola"), "Coca Cola");
    const body = buildCreateBody({ name: "Grande de calabresa", priceCents: 1_500_000 }, { id: "c-pizzas", channel_visibility: "ambos" }, "https://x/a.jpg");
    assert.equal(body.name, "Calabresa");
    assert.equal(body.image_url, "https://x/a.jpg");
    assert.deepEqual(body.variants, [{ id: "new:a", label: "Entera" }]);
    assert.deepEqual(body.prices, [
      { variant_id: "new:a", channel: "salon", amount: 15000, active: true },
      { variant_id: "new:a", channel: "delivery", amount: 15000, active: true },
    ]);
  });

  it("crea en el sitio, sube la foto y guarda el vínculo; valida categoría y duplicados", async () => {
    const t = setup();
    t.addProduct("a", 1_500_000, `${BASE}/a.jpg`);
    const deps = { store: t.store, client: t.site.client, fetchImpl: photoFetch, publicBaseUrl: BASE, linkedBy: "u1" };
    await assert.rejects(createProductOnSite(deps, { appProductId: "a", siteCategoryId: "no-existe" }), (e: unknown) => e instanceof CreateProductError && /categoría/.test(e.message));
    await assert.rejects(createProductOnSite(deps, { appProductId: "zzz", siteCategoryId: "c-pizzas" }), (e: unknown) => e instanceof CreateProductError && e.status === 404);
    const r = await createProductOnSite(deps, { appProductId: "a", siteCategoryId: "c-pizzas" });
    assert.equal(r.siteId, "nuevo");
    assert.equal(r.photo, "subida");
    const row = t.db.raw.prepare("SELECT site_id, pushed_image_url, linked_by FROM site_links WHERE app_product_id = 'a'").get() as Record<string, string>;
    assert.deepEqual([row.site_id, row.pushed_image_url, row.linked_by], ["nuevo", `${BASE}/a.jpg`, "u1"]);
    await assert.rejects(createProductOnSite(deps, { appProductId: "a", siteCategoryId: "c-pizzas" }), (e: unknown) => e instanceof CreateProductError && e.status === 409);
  });
});

describe("rutas", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  it("el cron exige CRON_SECRET igual que encuestas", () => {
    const src = read("src/app/api/cron/sitio-publish/route.ts");
    assert.match(src, /isCronAuthorized\(req\.headers\.get\("authorization"\), process\.env\.CRON_SECRET\)/);
    assert.match(src, /status: 401/);
    assert.match(src, /skipped: "sin_clave"/);
  });
  it("las rutas de admin usan el guard solo-dueño con límite bajo", () => {
    assert.match(read("src/app/api/admin/sitio/publish/route.ts"), /guard\(req, 5\)/);
    assert.match(read("src/app/api/admin/sitio/create-product/route.ts"), /guard\(req, 10\)/);
  });
  it("PATCH de productos dispara la publicación por cambio sin esperarla", () => {
    assert.match(read("src/app/api/products/route.ts"), /publishProductChange\(id\)/);
  });
});
