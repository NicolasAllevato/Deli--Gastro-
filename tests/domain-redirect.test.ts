import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Usa el path-to-regexp que Next trae compilado, el mismo que evalúa los redirects.
// Es una ruta interna: si una actualización de Next la mueve, hay que ajustar este import.
const require = createRequire(import.meta.url);
const { match } = require("next/dist/compiled/path-to-regexp") as {
  match: (path: string) => (input: string) => false | { params: Record<string, string> };
};

const NEW = "https://opsyndely.la-gambeta.com";
const { default: nextConfig } = await import("../next.config.ts");
const rules = (await nextConfig.redirects?.()) ?? [];
const byHost = (host: string) => rules.filter((r) => r.has?.some((h) => h.type === "host" && h.value === host));

const matcher = (source: string) => (pathname: string) => match(source)(pathname) !== false;

describe("redirect de deli-gastro.vercel.app", () => {
  const [rule] = byHost("deli-gastro.vercel.app");
  const matches = matcher(rule?.source ?? "");

  it("existe la regla y es temporal hacia el dominio nuevo", () => {
    assert.ok(rule, "falta la regla de redirect");
    assert.equal(rule.permanent, false);
    assert.equal(rule.destination, `${NEW}/:path`);
  });

  it("redirige la portada y las páginas", () => {
    assert.ok(matches("/"));
    assert.ok(matches("/cliente/carrito"));
    assert.ok(matches("/repartidor"));
    assert.ok(matches("/apiary")); // empieza con "api" pero no es /api
  });

  it("no toca /api: webhooks y crons no siguen redirects", () => {
    assert.ok(!matches("/api"));
    assert.ok(!matches("/api/whatsapp/webhook"));
  });
});

describe("redirect de dely.opsyn.app (corte a Cloudflare)", () => {
  const rulesHost = byHost("dely.opsyn.app");
  const [pages] = rulesHost;
  const matches = matcher(pages?.source ?? "");

  it("una sola regla, temporal, hacia el dominio nuevo", () => {
    assert.equal(rulesHost.length, 1);
    assert.equal(pages.destination, `${NEW}/:path`);
    assert.equal(pages.permanent, false);
  });

  it("redirige todas las páginas, incluido el repartidor y el login", () => {
    for (const p of ["/", "/admin/tablero", "/cliente", "/repartidor", "/repartidor/x", "/login", "/descargas/dely-repartidor.apk"])
      assert.ok(matches(p), p);
  });

  it("no toca /api", () => {
    for (const p of ["/api", "/api/cron/surveys"]) assert.ok(!matches(p), p);
  });
});

describe("dominios de la app", () => {
  const rulesHost = byHost("www.opsyndely.la-gambeta.com");
  const [pages] = rulesHost;
  const matches = matcher(pages?.source ?? "");
  const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const hosts = [...wrangler.matchAll(/"pattern":\s*"([^"]+)"/g)].map((m) => m[1]);

  it("el Worker solo atiende los dos dominios de la app", () => {
    assert.deepEqual(hosts.sort(), ["opsyndely.la-gambeta.com", "www.opsyndely.la-gambeta.com"]);
  });

  it("www.opsyndely manda las páginas al dominio canónico", () => {
    assert.equal(rulesHost.length, 1);
    assert.equal(pages.destination, `${NEW}/:path`);
    assert.equal(pages.permanent, false);
    for (const p of ["/", "/login", "/admin/tablero"]) assert.ok(matches(p), p);
  });

  it("no toca /api", () => {
    for (const p of ["/api", "/api/cron/surveys"]) assert.ok(!matches(p), p);
  });

  it("no hay reglas sobre el sitio web ni sobre el dominio canónico", () => {
    for (const host of ["la-gambeta.com", "www.la-gambeta.com", "opsyndely.la-gambeta.com"])
      assert.equal(byHost(host).length, 0, host);
  });
});
