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
  const pages = rulesHost.find((r) => r.source !== "/login");
  const login = rulesHost.find((r) => r.source === "/login");
  const matches = matcher(pages?.source ?? "");

  it("manda las páginas al dominio nuevo, en temporal", () => {
    assert.ok(pages, "falta la regla de páginas");
    assert.equal(pages.destination, `${NEW}/:path`);
    assert.equal(pages.permanent, false);
    assert.ok(matches("/"));
    assert.ok(matches("/admin/tablero"));
    assert.ok(matches("/cliente"));
    assert.ok(matches("/descargas/dely-repartidor.apk"));
    assert.ok(matches("/repartidores")); // no es /repartidor
    assert.ok(matches("/login-algo"));
  });

  it("no toca /api ni el portal del repartidor (APK v1.0)", () => {
    for (const p of ["/api", "/api/cron/surveys", "/repartidor", "/repartidor/x", "/login"]) assert.ok(!matches(p), p);
  });

  it("/login se redirige salvo el ingreso con PIN de la APK", () => {
    assert.ok(login, "falta la regla de /login");
    assert.equal(login.destination, `${NEW}/login`);
    const miss = login.missing?.[0];
    assert.ok(miss && miss.type === "query" && miss.key === "redirectTo");
    const re = new RegExp(`^${miss.value}$`);
    assert.ok(re.test("/repartidor"));
    assert.ok(!re.test("/admin"));
  });
});
