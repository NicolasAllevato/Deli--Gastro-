import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Usa el path-to-regexp que Next trae compilado, el mismo que evalúa los redirects.
// Es una ruta interna: si una actualización de Next la mueve, hay que ajustar este import.
const require = createRequire(import.meta.url);
const { match } = require("next/dist/compiled/path-to-regexp") as {
  match: (path: string) => (input: string) => false | { params: Record<string, string> };
};

const { default: nextConfig } = await import("../next.config.ts");
const rules = (await nextConfig.redirects?.()) ?? [];
const rule = rules.find((r) => r.has?.some((h) => h.type === "host" && h.value === "deli-gastro.vercel.app"));

function matches(pathname: string): boolean {
  assert.ok(rule, "falta la regla de redirect");
  return match(rule.source)(pathname) !== false;
}

describe("redirect del dominio viejo de Vercel", () => {
  it("existe la regla y es temporal hacia dely.opsyn.app", () => {
    assert.ok(rule, "falta la regla de redirect");
    assert.equal(rule.permanent, false);
    assert.equal(rule.destination, "https://dely.opsyn.app/:path");
  });

  it("redirige la portada y las páginas", () => {
    assert.ok(matches("/"));
    assert.ok(matches("/cliente/carrito"));
    assert.ok(matches("/repartidor"));
    assert.ok(matches("/descargas/dely-repartidor.apk"));
    assert.ok(matches("/apiary")); // empieza con "api" pero no es /api
  });

  it("no toca /api: webhooks y crons no siguen redirects", () => {
    assert.ok(!matches("/api"));
    assert.ok(!matches("/api/"));
    assert.ok(!matches("/api/whatsapp/webhook"));
    assert.ok(!matches("/api/cron/surveys"));
  });
});
