import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dailySummaryUrl, surveysUrl, triggerDailySummary, triggerSurveys } from "./index.ts";

describe("surveysUrl", () => {
  it("normaliza la barra final", () => {
    assert.equal(surveysUrl("https://app.example.com/"), "https://app.example.com/api/cron/surveys");
  });

  it("falla si falta o no es http(s)", () => {
    assert.throws(() => surveysUrl(undefined), /BASE_URL/);
    assert.throws(() => surveysUrl(""), /BASE_URL/);
    assert.throws(() => surveysUrl("app.example.com"), /BASE_URL/);
  });
});

describe("triggerSurveys", () => {
  const env = { BASE_URL: "https://app.example.com", CRON_SECRET: "s3cret" };

  it("llama con el Bearer y devuelve el resultado", async () => {
    let seen: { url: string; auth: string | null } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, auth: new Headers(init.headers).get("authorization") };
      return new Response(JSON.stringify({ sent: 2 }), { status: 200 });
    }) as unknown as typeof fetch;

    assert.deepEqual(await triggerSurveys(env, fetchImpl), { sent: 2 });
    assert.deepEqual(seen, { url: "https://app.example.com/api/cron/surveys", auth: "Bearer s3cret" });
  });

  it("lanza si la app responde distinto de 2xx", async () => {
    const fetchImpl = (async () => new Response("No autorizado", { status: 401 })) as unknown as typeof fetch;
    await assert.rejects(() => triggerSurveys(env, fetchImpl), /401/);
  });

  it("lanza sin CRON_SECRET antes de hacer la llamada", async () => {
    let called = false;
    const fetchImpl = (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch;
    await assert.rejects(() => triggerSurveys({ ...env, CRON_SECRET: "" }, fetchImpl), /CRON_SECRET/);
    assert.equal(called, false);
  });
});

describe("resumen diario", () => {
  const env = { BASE_URL: "https://app.example.com/", CRON_SECRET: "s3cret" };

  it("arma la URL del endpoint del resumen", () => {
    assert.equal(dailySummaryUrl(env.BASE_URL), "https://app.example.com/api/cron/daily-summary");
  });

  it("llama al endpoint del resumen con el Bearer", async () => {
    let seen: { url: string; auth: string | null } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, auth: new Headers(init.headers).get("authorization") };
      return new Response(JSON.stringify({ sent: false }), { status: 200 });
    }) as unknown as typeof fetch;

    assert.deepEqual(await triggerDailySummary(env, fetchImpl), { sent: false });
    assert.deepEqual(seen, { url: "https://app.example.com/api/cron/daily-summary", auth: "Bearer s3cret" });
  });
});
