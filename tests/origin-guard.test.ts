import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSameOriginRequest } from "../src/lib/auth/origin-guard.ts";

const H = (o: Record<string, string>) => new Headers(o);
const HOST = "dely.opsyn.app";
const ok = (h: Record<string, string>, m = "POST") => assert.equal(isSameOriginRequest(H(h), m), true);
const no = (h: Record<string, string>, m = "POST") => assert.equal(isSameOriginRequest(H(h), m), false);

describe("isSameOriginRequest", () => {
  it("métodos seguros siempre pasan, incluso cross-site", () => {
    for (const m of ["GET", "HEAD", "OPTIONS", "get"]) ok({ "sec-fetch-site": "cross-site", host: HOST }, m);
  });

  it("Sec-Fetch-Site same-origin y none pasan en métodos mutantes", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      ok({ "sec-fetch-site": "same-origin", host: HOST }, m);
      ok({ "sec-fetch-site": "none", host: HOST }, m);
    }
  });

  it("cross-site y same-site se rechazan aunque el Origin coincida", () => {
    no({ "sec-fetch-site": "cross-site", host: HOST, origin: `https://${HOST}` });
    no({ "sec-fetch-site": "same-site", host: HOST, origin: `https://${HOST}` });
  });

  it("Origin igual al host pasa; distinto se rechaza", () => {
    ok({ origin: `https://${HOST}`, host: HOST });
    no({ origin: "https://evil.com", host: HOST });
  });

  it("puerto y esquema", () => {
    ok({ origin: "http://localhost:5178", host: "localhost:5178" });
    no({ origin: "http://localhost:3000", host: "localhost:5178" });
    ok({ origin: `https://${HOST}:443`, host: HOST, "x-forwarded-proto": "https" });
    no({ origin: `http://${HOST}`, host: HOST, "x-forwarded-proto": "https" });
  });

  it("usa x-forwarded-host por encima de host", () => {
    ok({ origin: `https://${HOST}`, host: "internal:3000", "x-forwarded-host": HOST, "x-forwarded-proto": "https" });
    no({ origin: "https://internal:3000", host: "internal:3000", "x-forwarded-host": HOST });
  });

  it("Referer como respaldo cuando no hay Origin", () => {
    ok({ referer: `https://${HOST}/admin/pedidos`, host: HOST, "x-forwarded-proto": "https" });
    no({ referer: "https://evil.com/x", host: HOST });
  });

  it("sin ninguna señal (curl, Workers, Playwright API) pasa", () => {
    ok({ host: HOST });
    ok({});
  });

  it("bypass: Origin null, subdominio parecido, host en la query", () => {
    no({ origin: "null", host: HOST });
    no({ origin: `https://${HOST}.evil.com`, host: HOST });
    no({ origin: `https://evil.${HOST}`, host: HOST });
    no({ origin: `https://evil.com/?${HOST}`, host: HOST });
    no({ origin: `https://${HOST}@evil.com`, host: HOST });
    no({ referer: `https://evil.com/?${HOST}`, host: HOST });
    no({ referer: `https://${HOST}.evil.com/`, host: HOST });
    no({ origin: "javascript:alert(1)", host: HOST });
    no({ origin: "", host: HOST });
  });

  it("Origin presente pero sin host efectivo se rechaza", () => {
    no({ origin: `https://${HOST}` });
  });

  it("Sec-Fetch-Site desconocido cae a Origin", () => {
    ok({ "sec-fetch-site": "weird", origin: `https://${HOST}`, host: HOST, "x-forwarded-proto": "https" });
    no({ "sec-fetch-site": "weird", origin: "https://evil.com", host: HOST });
  });
});
