import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  completeSignup,
  isDemoSafe,
  parseSignupRequest,
  PhoneResolutionError,
  SignupValidationError,
  signupErrorResponse,
} from "../src/lib/whatsapp/signup-flow.ts";
import { WhatsAppApiError } from "../src/lib/whatsapp/client.ts";
import { isCoexistenceValue, type SignupBody } from "../src/lib/whatsapp/embedded-signup.ts";

interface Call {
  url: string;
  method: string;
  auth: string | null;
  body: string | null;
}

type Route = [RegExp, { status?: number; json: unknown }];

/** fetch simulado: responde según la URL y registra cada llamada. */
function fakeGraph(routes: Route[]) {
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

function setup(routes: Route[], hasWorkingConfig = false) {
  const graph = fakeGraph(routes);
  const saved: Array<Record<string, string>> = [];
  const deps = {
    appId: "111",
    appSecret: "secret",
    hasWorkingConfig,
    fetchImpl: graph.impl,
    save: async (patch: Record<string, string>) => {
      saved.push(patch);
    },
  };
  return { ...graph, saved, deps };
}

const TOKEN: Route = [/oauth\/access_token/, { json: { access_token: "TOKEN-NEGOCIO" } }];
const SUBSCRIBE: Route = [/\/2220002\/subscribed_apps/, { json: { success: true } }];
const ONE_NUMBER: Route = [/\/2220002\/phone_numbers/, { json: { data: [{ id: "1110001" }] } }];

const coexistence = (extra: Record<string, string> = {}): SignupBody =>
  ({ mode: "coexistence", code: "CODE", wabaId: "2220002", ...extra }) as SignupBody;
const standard: SignupBody = { mode: "standard", code: "CODE", phoneNumberId: "1110001", wabaId: "2220002", pin: "123456" };

describe("completeSignup: coexistencia", () => {
  it("canjea el code, resuelve el número, suscribe sin registrar ni PIN y guarda al final", async () => {
    const t = setup([TOKEN, ONE_NUMBER, SUBSCRIBE]);
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

  it("si el body trae el phoneNumberId y figura en la cuenta, lo usa", async () => {
    const t = setup([TOKEN, ONE_NUMBER, SUBSCRIBE]);
    const result = await completeSignup(coexistence({ phoneNumberId: "1110001" }), t.deps);
    assert.equal(result.phoneNumberId, "1110001");
  });

  it("0 números sin config previa: guarda token y waba, 409 con code phone_resolution", async () => {
    const t = setup([TOKEN, [/phone_numbers/, { json: { data: [] } }]]);
    await assert.rejects(completeSignup(coexistence(), t.deps), (e: unknown) => {
      assert.ok(e instanceof PhoneResolutionError);
      assert.equal(e.status, 409);
      assert.equal(e.code, "phone_resolution");
      assert.match(e.message, /ya quedaron guardados/);
      return true;
    });
    assert.deepEqual(t.saved, [{ accessToken: "TOKEN-NEGOCIO", wabaId: "2220002" }]);
  });

  it("más de un número sin config previa: guarda token y waba y explica cómo seguir", async () => {
    const t = setup([TOKEN, [/phone_numbers/, { json: { data: [{ id: "1" }, { id: "2" }] } }]]);
    await assert.rejects(completeSignup(coexistence(), t.deps), /2 números[\s\S]*Phone Number ID a mano/);
    assert.equal(t.saved.length, 1);
    assert.equal(t.saved[0].phoneNumberId, undefined);
  });

  it("0 o >1 números con config previa que funciona: NO guarda nada", async () => {
    for (const data of [[], [{ id: "1" }, { id: "2" }]]) {
      const t = setup([TOKEN, [/phone_numbers/, { json: { data } }]], true);
      await assert.rejects(completeSignup(coexistence(), t.deps), (e: unknown) => {
        assert.ok(e instanceof PhoneResolutionError);
        assert.match(e.message, /no se modificó/);
        return true;
      });
      assert.equal(t.saved.length, 0);
    }
  });

  it("propiedad: un phoneNumberId que no figura en la cuenta se rechaza con 400 sin guardar", async () => {
    const t = setup([TOKEN, ONE_NUMBER, SUBSCRIBE]);
    await assert.rejects(
      completeSignup(coexistence({ phoneNumberId: "9999999" }), t.deps),
      (e: unknown) => e instanceof SignupValidationError && e.status === 400,
    );
    assert.equal(t.saved.length, 0);
    assert.equal(t.calls.some((c) => /subscribed_apps/.test(c.url)), false);
  });

  it("propaga el error de Meta al canjear el code y no guarda", async () => {
    const t = setup([[/oauth\/access_token/, { status: 400, json: { error: { message: "code vencido" } } }]]);
    await assert.rejects(completeSignup(coexistence(), t.deps), /code vencido/);
    assert.equal(t.saved.length, 0);
  });

  it("si falla la suscripción no persiste nada (no pisa una config que funciona)", async () => {
    const t = setup([TOKEN, ONE_NUMBER, [/subscribed_apps/, { status: 403, json: { error: { message: "sin permiso" } } }]], true);
    await assert.rejects(completeSignup(coexistence(), t.deps), /sin permiso/);
    assert.equal(t.saved.length, 0);
  });
});

describe("completeSignup: estándar (decidido por el evento FINISH)", () => {
  const routes: Route[] = [TOKEN, ONE_NUMBER, [/\/1110001\/register/, { json: { success: true } }], SUBSCRIBE];

  it("registra el número con el PIN y suscribe la app; guarda recién al final", async () => {
    const t = setup(routes);
    await completeSignup(standard, t.deps);
    const register = t.calls.find((c) => /\/register/.test(c.url));
    assert.equal(register?.method, "POST");
    assert.match(register?.body ?? "", /"pin":"123456"/);
    assert.equal(t.calls.some((c) => /subscribed_apps/.test(c.url)), true);
    assert.equal(t.saved.length, 1);
  });

  it("tolera que el número ya esté registrado", async () => {
    const t = setup([TOKEN, ONE_NUMBER, [/\/register/, { status: 400, json: { error: { message: "Number already registered" } } }], SUBSCRIBE]);
    const result = await completeSignup(standard, t.deps);
    assert.equal(result.phoneNumberId, "1110001");
  });

  it("falla ante otro error de registro y no guarda", async () => {
    const t = setup([TOKEN, ONE_NUMBER, [/\/register/, { status: 400, json: { error: { message: "PIN incorrecto" } } }]], true);
    await assert.rejects(completeSignup(standard, t.deps), /PIN incorrecto/);
    assert.equal(t.saved.length, 0);
  });

  it("propiedad: un número que no es de la cuenta se rechaza antes de registrar", async () => {
    const t = setup([TOKEN, [/phone_numbers/, { json: { data: [{ id: "5550005" }] } }]]);
    await assert.rejects(completeSignup(standard, t.deps), SignupValidationError);
    assert.equal(t.calls.some((c) => /register/.test(c.url)), false);
    assert.equal(t.saved.length, 0);
  });
});

describe("completeSignup: demo", () => {
  function demoClient() {
    const state = { subscribed: false };
    return {
      state,
      client: {
        registerPhone: async () => undefined,
        subscribeApp: async () => {
          state.subscribed = true;
          return { success: true };
        },
        getPhoneInfo: async () => ({ display_phone_number: "x", verified_name: "y" }),
        getWabaInfo: async () => ({ id: "w" }),
        isAppSubscribed: async () => true,
      },
    };
  }

  it("no sale a internet, usa el cliente inyectado y el número de demo 100000000000001", async () => {
    const t = setup([]);
    const d = demoClient();
    const result = await completeSignup(coexistence(), { ...t.deps, demo: true, buildClient: () => d.client });
    assert.equal(t.calls.length, 0);
    assert.equal(d.state.subscribed, true);
    assert.equal(result.phoneNumberId, "100000000000001");
    assert.equal(t.saved[0].accessToken, "demo-token");
  });
});

describe("isDemoSafe", () => {
  it("solo es seguro con demo activo y sin credenciales reales de Supabase", () => {
    assert.equal(isDemoSafe({ demoMode: true }), true);
    assert.equal(isDemoSafe({ demoMode: true, supabaseUrl: "", serviceRoleKey: "  " }), true);
    assert.equal(isDemoSafe({ demoMode: true, supabaseUrl: "https://x.supabase.co" }), false);
    assert.equal(isDemoSafe({ demoMode: true, serviceRoleKey: "key" }), false);
    assert.equal(isDemoSafe({ demoMode: false }), false);
  });
});

describe("parseSignupRequest: reglas de modo y 400", () => {
  const coexBody = { mode: "coexistence", code: "C", wabaId: "2220002" };
  const stdBody = { mode: "standard", code: "C", phoneNumberId: "1110001", wabaId: "2220002", pin: "123456" };

  it("coexistence solo se acepta con el interruptor guardado activo", () => {
    assert.equal(parseSignupRequest(coexBody, true).ok, true);
    const off = parseSignupRequest(coexBody, false);
    assert.equal(off.ok, false);
    assert.match(off.ok ? "" : off.error, /coexistencia desactivada/);
  });

  it("standard se acepta siempre, también con la coexistencia activa (Meta terminó como número nuevo)", () => {
    assert.equal(parseSignupRequest(stdBody, true).ok, true);
    assert.equal(parseSignupRequest(stdBody, false).ok, true);
  });

  it("mensajes de error en español", () => {
    const msg = (raw: unknown) => {
      const r = parseSignupRequest(raw, true);
      return r.ok ? "" : r.error;
    };
    assert.match(msg(null), /tipo de alta/);
    assert.match(msg({}), /tipo de alta/);
    assert.match(msg({ ...stdBody, mode: "otro" }), /tipo de alta/);
    assert.match(msg({ ...stdBody, pin: undefined }), /PIN/);
    assert.match(msg({ ...stdBody, code: undefined }), /código/);
    assert.match(msg({ ...coexBody, wabaId: undefined }), /WABA/);
    assert.match(msg({ ...coexBody, extra: 1 }), /no corresponden/);
  });
});

describe("signupErrorResponse", () => {
  it("409 propio lleva code phone_resolution", () => {
    const r = signupErrorResponse(new PhoneResolutionError("x"));
    assert.deepEqual(r, { status: 409, body: { error: "x", code: "phone_resolution" } });
  });

  it("un 409 de Graph sale como 502 sin code (la UI los distingue)", () => {
    const r = signupErrorResponse(new WhatsAppApiError(409, "conflicto de Meta"));
    assert.equal(r.status, 502);
    assert.equal(r.body.code, undefined);
  });

  it("validación 400, error genérico 502 sin filtrar detalles", () => {
    assert.equal(signupErrorResponse(new SignupValidationError("no es tuyo")).status, 400);
    const generic = signupErrorResponse(new Error("detalle interno con token"));
    assert.equal(generic.status, 502);
    assert.doesNotMatch(generic.body.error, /token/);
  });
});

describe("isCoexistenceValue", () => {
  it("vacío o ausente = comportamiento anterior (no coexistencia)", () => {
    for (const v of [null, undefined, "", "  ", "0", "false", "no"]) assert.equal(isCoexistenceValue(v), false);
  });

  it("solo valores afirmativos la activan", () => {
    for (const v of ["1", "true", "TRUE", "si", "sí", " 1 "]) assert.equal(isCoexistenceValue(v), true);
  });
});

describe("completeSignup: discover", () => {
  const discover: SignupBody = { mode: "discover", code: "CODE", pin: "123456" };
  const debugToken = (scopes: unknown): Route => [/debug_token/, { json: { data: { granular_scopes: scopes } } }];
  const REGISTER: Route = [/\/1110001\/register/, { json: { success: true } }];

  it("1 WABA y 1 numero: descubre, registra con PIN, suscribe y guarda", async () => {
    const t = setup([
      TOKEN,
      debugToken([
        { scope: "whatsapp_business_management", target_ids: ["2220002"] },
        { scope: "business_management", target_ids: ["999"] },
      ]),
      ONE_NUMBER,
      REGISTER,
      SUBSCRIBE,
    ]);
    const result = await completeSignup(discover, t.deps);

    assert.equal(result.phoneNumberId, "1110001");
    assert.deepEqual(t.saved, [{ accessToken: "TOKEN-NEGOCIO", phoneNumberId: "1110001", wabaId: "2220002" }]);
    const debug = t.calls.find((c) => /debug_token/.test(c.url));
    assert.match(debug?.url ?? "", /input_token=TOKEN-NEGOCIO/);
    assert.match(debug?.url ?? "", /access_token=111%7Csecret/);
    const reg = t.calls.find((c) => /\/register/.test(c.url));
    assert.match(reg?.body ?? "", /123456/);
  });

  it("usa whatsapp_business_messaging si no hay management", async () => {
    const t = setup([TOKEN, debugToken([{ scope: "whatsapp_business_messaging", target_ids: ["2220002"] }]), ONE_NUMBER, REGISTER, SUBSCRIBE]);
    const result = await completeSignup(discover, t.deps);
    assert.equal(result.phoneNumberId, "1110001");
  });

  it("2 WABA: error claro 400 y no guarda", async () => {
    const t = setup([TOKEN, debugToken([{ scope: "whatsapp_business_management", target_ids: ["2220002", "2220003"] }])]);
    await assert.rejects(completeSignup(discover, t.deps), (e: unknown) => {
      assert.ok(e instanceof SignupValidationError);
      assert.match(e.message, /2 cuentas[\s\S]*carga manual/);
      assert.equal(signupErrorResponse(e).status, 400);
      return true;
    });
    assert.equal(t.saved.length, 0);
  });

  it("sin scopes de WhatsApp: error claro y no guarda", async () => {
    const t = setup([TOKEN, debugToken([{ scope: "business_management", target_ids: ["999"] }])]);
    await assert.rejects(completeSignup(discover, t.deps), /no informó la cuenta[\s\S]*carga manual/);
    assert.equal(t.saved.length, 0);
  });

  it("2 numeros en la WABA: error claro y no guarda", async () => {
    const t = setup([
      TOKEN,
      debugToken([{ scope: "whatsapp_business_management", target_ids: ["2220002"] }]),
      [/\/2220002\/phone_numbers/, { json: { data: [{ id: "1" }, { id: "2" }] } }],
    ]);
    await assert.rejects(completeSignup(discover, t.deps), /2 números[\s\S]*carga manual/);
    assert.equal(t.saved.length, 0);
  });

  it("parseSignupRequest acepta discover aunque la coexistencia este apagada", () => {
    const r = parseSignupRequest({ mode: "discover", code: "CODE", pin: "123456" }, false);
    assert.equal(r.ok, true);
  });
});
