/**
 * Credenciales en D1 cifradas (integration_settings): cifrado, precedencia D1 > entorno,
 * guardado del alta con DATA_BACKEND=d1 y lectura del Worker whatsapp-bot.
 */
import "./helpers/alias.ts";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./helpers/sqlite-d1.ts";
import { decryptSetting, encryptSetting } from "../src/lib/crypto/settings-cipher.ts";
import { readIntegrationSettings, writeIntegrationSettings } from "../src/lib/data/integration-settings.ts";
import { executeD1Plan } from "../src/lib/data/plan-sql.ts";
import { loadD1BotSecrets, resetD1SecretsCache } from "../workers/whatsapp-bot/src/secrets-d1.ts";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");

const config = await import("../src/lib/whatsapp/config.ts");
const agent = await import("../src/lib/agent/settings.ts");
const connectedBy = await import("../src/lib/whatsapp/connected-by-store.ts");

/** Cliente Supabase que no debe usarse con D1. */
const noSupabase = new Proxy({}, { get: () => { throw new Error("no debería tocar Supabase"); } }) as never;

const ENV_NAMES = ["DATA_BACKEND", "SETTINGS_ENC_KEY", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_WABA_ID", "OPENAI_API_KEY"];
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n]]));
  for (const n of ENV_NAMES) delete process.env[n];
});
afterEach(() => {
  for (const n of ENV_NAMES) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
});

describe("settings-cipher (AES-GCM)", () => {
  it("ida y vuelta con formato v1", async () => {
    const enc = await encryptSetting("EAAG-token-secreto", KEY);
    assert.match(enc, /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    assert.ok(!enc.includes("EAAG"));
    assert.equal(await decryptSetting(enc, KEY), "EAAG-token-secreto");
  });

  it("IV distinto en cada cifrado", async () => {
    const a = await encryptSetting("igual", KEY);
    const b = await encryptSetting("igual", KEY);
    assert.notEqual(a, b);
    assert.notEqual(a.split(":")[1], b.split(":")[1]);
  });

  it("clave equivocada, alterado o formato raro: falla", async () => {
    const enc = await encryptSetting("valor", KEY);
    await assert.rejects(decryptSetting(enc, OTHER_KEY));
    const [v, iv, ct] = enc.split(":");
    const tampered = `${v}:${iv}:${ct!.slice(0, -4)}AAAA`;
    await assert.rejects(decryptSetting(tampered, KEY));
    await assert.rejects(decryptSetting("v2:a:b", KEY));
  });

  it("clave faltante o de largo incorrecto: falla", async () => {
    await assert.rejects(encryptSetting("x", undefined), /SETTINGS_ENC_KEY/);
    await assert.rejects(encryptSetting("x", Buffer.alloc(16).toString("base64")), /32 bytes/);
  });
});

describe("integration_settings en D1", () => {
  it("guarda cifrado y lee en claro; upsert pisa", async () => {
    const db = createTestDb();
    await writeIntegrationSettings(db, [{ key: "a", value: "uno" }], KEY, "u-admin");
    await writeIntegrationSettings(db, [{ key: "a", value: "dos" }], KEY);
    const raw = db.raw.prepare("SELECT value_enc FROM integration_settings WHERE key = 'a'").get() as { value_enc: string };
    assert.ok(raw.value_enc.startsWith("v1:"));
    assert.equal((await readIntegrationSettings(db, ["a", "b"], KEY)).get("a"), "dos");
  });

  it("un valor que no descifra se omite (no se rompe la lectura)", async () => {
    const db = createTestDb();
    await writeIntegrationSettings(db, [{ key: "a", value: "uno" }], OTHER_KEY);
    const logs: string[] = [];
    assert.equal((await readIntegrationSettings(db, ["a"], KEY, (m) => logs.push(m))).size, 0);
    assert.equal(logs.length, 1);
    assert.ok(!logs[0]!.includes("uno"));
  });

  it("el adaptador genérico plan-sql no expone la tabla", async () => {
    const db = createTestDb();
    const r = await executeD1Plan(db, { kind: "system" } as never, {
      table: "integration_settings", action: "select", columns: "*", filters: [], order: [], limit: null, payload: null, onConflict: "",
    } as never);
    assert.ok(r.error);
  });
});

describe("config de WhatsApp con DATA_BACKEND=d1", () => {
  it("lo guardado en D1 gana sobre el entorno; el entorno es respaldo", async () => {
    process.env.DATA_BACKEND = "d1";
    process.env.SETTINGS_ENC_KEY = KEY;
    process.env.WHATSAPP_ACCESS_TOKEN = "token-env";
    process.env.WHATSAPP_WABA_ID = "waba-env";
    const db = createTestDb();
    await config.saveWhatsAppSettings(noSupabase, { accessToken: "token-panel", phoneNumberId: "123" }, db);
    const s = await config.loadWhatsAppSettings(noSupabase, db);
    assert.equal(s.accessToken, "token-panel");
    assert.equal(s.phoneNumberId, "123");
    assert.equal(s.wabaId, "waba-env");
    assert.deepEqual(config.envOverrides(["accessToken"]), []);
  });

  it("supabase: el entorno sigue ganando (sin cambios)", async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "token-env";
    const fake = {
      from: () => ({ select: () => ({ in: async () => ({ data: [{ key: "whatsapp_access_token", value: "token-db" }] }) }) }),
    } as never;
    assert.equal((await config.loadWhatsAppSettings(fake)).accessToken, "token-env");
    assert.deepEqual(config.envOverrides(["accessToken"]), ["WHATSAPP_ACCESS_TOKEN"]);
  });

  it("sin SETTINGS_ENC_KEY el guardado falla con mensaje claro", async () => {
    process.env.DATA_BACKEND = "d1";
    await assert.rejects(config.saveWhatsAppSettings(noSupabase, { accessToken: "x" }, createTestDb()), /SETTINGS_ENC_KEY/);
  });

  it("alta completa: token/ids y quién conectó quedan en D1", async () => {
    process.env.DATA_BACKEND = "d1";
    process.env.SETTINGS_ENC_KEY = KEY;
    const db = createTestDb();
    const { completeSignup } = await import("../src/lib/whatsapp/signup-flow.ts");
    const fakeClient = {
      registerPhone: async () => {}, subscribeApp: async () => ({ success: true }),
      getPhoneInfo: async () => ({}), getWabaInfo: async () => ({}), isAppSubscribed: async () => true,
    } as never;
    await completeSignup(
      { mode: "coexistence", code: "C", wabaId: "2220002", phoneNumberId: "1110001" } as never,
      { appId: "1", appSecret: "s", demo: true, hasWorkingConfig: false, save: (p) => config.saveWhatsAppSettings(noSupabase, p, db), buildClient: () => fakeClient },
    );
    await connectedBy.saveConnectedBy(noSupabase, { admin: { id: "u-admin", email: "a@x.test" } }, db);
    const s = await config.loadWhatsAppSettings(noSupabase, db);
    assert.equal(s.wabaId, "2220002");
    assert.equal(s.phoneNumberId, "1110001");
    assert.ok(s.accessToken);
    assert.ok(await connectedBy.loadConnectedBy(noSupabase, db));
  });

  it("clave de OpenAI: D1 gana sobre el entorno", async () => {
    process.env.DATA_BACKEND = "d1";
    process.env.SETTINGS_ENC_KEY = KEY;
    process.env.OPENAI_API_KEY = "sk-env";
    const db = createTestDb();
    assert.equal(await agent.loadOpenAIKey(noSupabase, db), "sk-env");
    await agent.saveOpenAIKey(noSupabase, "sk-panel", db);
    assert.equal(await agent.loadOpenAIKey(noSupabase, db), "sk-panel");
  });
});

describe("whatsapp-bot: credenciales desde D1", () => {
  beforeEach(() => resetD1SecretsCache());

  it("D1 gana, campo vacío cae al entorno, y cachea 60 s", async () => {
    const db = createTestDb();
    await writeIntegrationSettings(db, [{ key: "whatsapp_access_token", value: "tok-panel" }], KEY);
    const env = { SETTINGS_ENC_KEY: KEY, WHATSAPP_ACCESS_TOKEN: "tok-env", WHATSAPP_PHONE_NUMBER_ID: "pn-env" };
    const s = await loadD1BotSecrets(db, env, 1_000);
    assert.equal(s.accessToken, "tok-panel");
    assert.equal(s.phoneNumberId, "pn-env");
    await writeIntegrationSettings(db, [{ key: "whatsapp_access_token", value: "tok-nuevo" }], KEY);
    assert.equal((await loadD1BotSecrets(db, env, 30_000)).accessToken, "tok-panel");
    assert.equal((await loadD1BotSecrets(db, env, 62_000)).accessToken, "tok-nuevo");
  });

  it("si D1 falla usa el entorno", async () => {
    const broken = { prepare: () => { throw new Error("sin tabla"); } } as never;
    const s = await loadD1BotSecrets(broken, { WHATSAPP_APP_SECRET: "app-env" }, 0);
    assert.equal(s.appSecret, "app-env");
  });
});
