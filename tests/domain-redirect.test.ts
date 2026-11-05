import { describe, it } from "node:test";
import assert from "node:assert/strict";
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

describe("redirect de la raíz la-gambeta.com", () => {
  const rulesHost = byHost("la-gambeta.com");
  const [pages] = rulesHost;
  const matches = matcher(pages?.source ?? "");

  it("una sola regla, temporal, hacia el dominio de la app", () => {
    assert.equal(rulesHost.length, 1);
    assert.equal(pages.destination, `${NEW}/:path`);
    assert.equal(pages.permanent, false);
  });

  it("redirige la portada y las páginas", () => {
    for (const p of ["/", "/terminos", "/privacidad"]) assert.ok(matches(p), p);
  });

  it("no toca /api", () => {
    for (const p of ["/api", "/api/cron/surveys"]) assert.ok(!matches(p), p);
  });

  it("el dominio de la app no se redirige a sí mismo", () => {
    assert.equal(byHost("opsyndely.la-gambeta.com").length, 0);
  });
});
