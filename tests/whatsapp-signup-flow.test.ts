import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { completeSignup } from "../src/lib/whatsapp/signup-flow.ts";
import { WhatsAppApiError } from "../src/lib/whatsapp/client.ts";
import type { SignupBody } from "../src/lib/whatsapp/embedded-signup.ts";

interface Call {
  url: string;
  method: string;
  auth: string | null;
  body: string | null;
}

/** fetch simulado: responde según la URL y registra cada llamada. */
function fakeGraph(routes: Array<[RegExp, { status?: number; json: unknown }]>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, method: init?.method ?? "GET", auth: headers.Authorization ?? null, body: (init?.body as string) ?? null });
    const hit = routes.find(([re]) => re.test(url));
    const { status = 200, json } = hit?.[1] ?? { status: 404, json: { error: { message: "sin ruta" } } };
    return new Response(JSON.stringify(json), { status });
  }) as typeof fetch;
  return { impl, calls };
}

function setup(routes: Array<[RegExp, { status?: number; json: unknown }]>) {
  const graph = fakeGraph(routes);
  const saved: Array<Record<string, string>> = [];
  const deps = {
    appId: "111",
    appSecret: "secret",
    fetchImpl: graph.impl,
    save: async (patch: Record<string, string>) => {
      saved.push(patch);
    },
  };
  return { ...graph, saved, deps };
}

type Route = [RegExp, { status?: number; json: unknown }];
const TOKEN: Route = [/oauth\/access_token/, { json: { access_token: "TOKEN-NEGOCIO" } }];
const SUBSCRIBE: Route = [/\/2220002\/subscribed_apps/, { json: { success: true } }];

const coexistence = (extra: Partial<Extract<SignupBody, { mode: "coexistence" }>> = {}): SignupBody => ({
  mode: "coexistence",
  code: "CODE",
  wabaId: "2220002",
  ...extra,
});

describe("completeSignup: coexistencia", () => {
  it("canjea el code, resuelve el número, guarda y suscribe sin registrar ni PIN", async () => {
    const t = setup([TOKEN, [/\/2220002\/phone_numbers/, { json: { data: [{ id: "1110001" }] } }], SUBSCRIBE]);
    const result = await completeSignup(coexistence(), t.deps);

    assert.equal(result.phoneNumberId, "1110001");
    assert.deepEqual(t.saved, [{ accessToken: "TOKEN-NEGOCIO", phoneNumberId: "1110001", wabaId: "2220002" }]);
    assert.equal(t.calls.some((c) => /\/register/.test(c.url)), false, "no debe registrar el número");
    const sub = t.calls.find((c) => /subscribed_apps/.test(c.url));
    assert.equal(sub?.method, "POST");
    assert.equal(sub?.auth, "Bearer TOKEN-NEGOCIO");
    assert.match(t.calls[0].url, /client_secret=secret/);
    assert.match(t.calls[0].url, /code=CODE/);
  });

  it("si el body trae el phoneNumberId no consulta la lista de números", async () => {
    const t = setup([TOKEN, SUBSCRIBE]);
    const result = await completeSignup(coexistence({ phoneNumberId: "1110009" }), t.deps);
    assert.equal(result.phoneNumberId, "1110009");
    assert.equal(t.calls.some((c) => /phone_numbers/.test(c.url)), false);
  });

  it("con más de un número falla con 409 y no guarda nada", async () => {
    const t = setup([TOKEN, [/phone_numbers/, { json: { data: [{ id: "1" }, { id: "2" }] } }]]);
    await assert.rejects(completeSignup(coexistence(), t.deps), (e: unknown) => e instanceof WhatsAppApiError && e.status === 409);
    assert.equal(t.saved.length, 0);
  });

  it("sin números falla con 409", async () => {
    const t = setup([TOKEN, [/phone_numbers/, { json: { data: [] } }]]);
    await assert.rejects(completeSignup(coexistence(), t.deps), (e: unknown) => e instanceof WhatsAppApiError && e.status === 409);
    assert.equal(t.saved.length, 0);
  });

  it("propaga el error de Meta al canjear el code y no guarda", async () => {
    const t = setup([[/oauth\/access_token/, { status: 400, json: { error: { message: "code vencido" } } }]]);
    await assert.rejects(completeSignup(coexistence(), t.deps), /code vencido/);
    assert.equal(t.saved.length, 0);
  });

  it("propaga el error de suscripción", async () => {
    const t = setup([TOKEN, [/phone_numbers/, { json: { data: [{ id: "1110001" }] } }], [/subscribed_apps/, { status: 403, json: { error: { message: "sin permiso" } } }]]);
    await assert.rejects(completeSignup(coexistence(), t.deps), /sin permiso/);
  });
});

describe("completeSignup: estándar", () => {
  const body: SignupBody = { mode: "standard", code: "CODE", phoneNumberId: "1110001", wabaId: "2220002", pin: "123456" };

  it("registra el número con el PIN y suscribe la app", async () => {
    const t = setup([TOKEN, [/\/1110001\/register/, { json: { success: true } }], SUBSCRIBE]);
    await completeSignup(body, t.deps);
    const register = t.calls.find((c) => /\/register/.test(c.url));
    assert.equal(register?.method, "POST");
    assert.match(register?.body ?? "", /"pin":"123456"/);
    assert.equal(t.calls.some((c) => /subscribed_apps/.test(c.url)), true);
  });

  it("tolera que el número ya esté registrado", async () => {
    const t = setup([TOKEN, [/\/register/, { status: 400, json: { error: { message: "Number already registered" } } }], SUBSCRIBE]);
    const result = await completeSignup(body, t.deps);
    assert.equal(result.phoneNumberId, "1110001");
  });

  it("falla ante otro error de registro", async () => {
    const t = setup([TOKEN, [/\/register/, { status: 400, json: { error: { message: "PIN incorrecto" } } }]]);
    await assert.rejects(completeSignup(body, t.deps), /PIN incorrecto/);
  });
});

describe("completeSignup: demo", () => {
  it("no sale a internet y usa el cliente inyectado", async () => {
    const t = setup([]);
    let subscribed = false;
    const client = {
      registerPhone: async () => undefined,
      subscribeApp: async () => {
        subscribed = true;
        return { success: true };
      },
      getPhoneInfo: async () => ({ display_phone_number: "x", verified_name: "y" }),
      getWabaInfo: async () => ({ id: "w" }),
      isAppSubscribed: async () => true,
    };
    await completeSignup(coexistence(), { ...t.deps, demo: true, buildClient: () => client });
    assert.equal(t.calls.length, 0);
    assert.equal(subscribed, true);
    assert.equal(t.saved[0].accessToken, "demo-token");
  });
});
