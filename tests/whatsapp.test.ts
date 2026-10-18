import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifySignature } from "../src/lib/whatsapp/signature.ts";
import { parseWebhook } from "../src/lib/whatsapp/payload.ts";
import { normalizePhone, samePhone } from "../src/lib/whatsapp/phone.ts";
import { maskSecret } from "../src/lib/whatsapp/mask.ts";
import { createWhatsAppClient, exchangeCodeForToken, WhatsAppApiError } from "../src/lib/whatsapp/client.ts";

const SECRET = "app-secret";
const sign = (body: string, secret = SECRET) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("verifySignature", () => {
  const body = JSON.stringify({ hola: "mundo" });

  it("acepta una firma correcta", () => {
    assert.ok(verifySignature(body, sign(body), SECRET));
  });

  it("rechaza un cuerpo alterado", () => {
    assert.equal(verifySignature(`${body} `, sign(body), SECRET), false);
  });

  it("rechaza una firma hecha con otro secreto", () => {
    assert.equal(verifySignature(body, sign(body, "otro"), SECRET), false);
  });

  it("rechaza encabezados ausentes, mal formados o de otra longitud", () => {
    assert.equal(verifySignature(body, null, SECRET), false);
    assert.equal(verifySignature(body, "", SECRET), false);
    assert.equal(verifySignature(body, "sha1=abc", SECRET), false);
    assert.equal(verifySignature(body, "sha256=abc", SECRET), false);
  });

  it("rechaza todo si no hay secreto configurado", () => {
    assert.equal(verifySignature(body, sign(body, ""), ""), false);
  });
});

function envelope(value: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "WABA", changes: [{ field: "messages", value }] }],
  };
}

const META = { messaging_product: "whatsapp", metadata: { phone_number_id: "PNID", display_phone_number: "1" } };

describe("parseWebhook", () => {
  it("extrae un mensaje de texto con el nombre del contacto", () => {
    const events = parseWebhook(
      envelope({
        ...META,
        contacts: [{ profile: { name: "Juan" }, wa_id: "5491155550101" }],
        messages: [{ from: "5491155550101", id: "wamid.1", timestamp: "1700000000", type: "text", text: { body: "Hola" } }],
      }),
    );
    assert.deepEqual(events, [
      {
        kind: "message",
        wamid: "wamid.1",
        from: "5491155550101",
        name: "Juan",
        timestamp: 1700000000,
        phoneNumberId: "PNID",
        content: { type: "text", text: "Hola" },
      },
    ]);
  });

  it("extrae un audio con su id de media", () => {
    const [event] = parseWebhook(
      envelope({
        ...META,
        messages: [
          { from: "549", id: "wamid.2", timestamp: "1", type: "audio", audio: { id: "MEDIA", mime_type: "audio/ogg; codecs=opus" } },
        ],
      }),
    );
    assert.deepEqual(event?.kind === "message" && event.content, {
      type: "audio",
      mediaId: "MEDIA",
      mimeType: "audio/ogg; codecs=opus",
    });
  });

  it("trata la respuesta de un botón como texto", () => {
    const [event] = parseWebhook(
      envelope({
        ...META,
        messages: [
          {
            from: "549", id: "wamid.3", timestamp: "1", type: "interactive",
            interactive: { type: "button_reply", button_reply: { id: "si", title: "Sí, confirmar" } },
          },
        ],
      }),
    );
    assert.deepEqual(event?.kind === "message" && event.content, { type: "text", text: "Sí, confirmar" });
  });

  it("marca como no soportados los tipos que el agente no entiende", () => {
    const [event] = parseWebhook(
      envelope({ ...META, messages: [{ from: "549", id: "wamid.4", timestamp: "1", type: "sticker", sticker: {} }] }),
    );
    assert.deepEqual(event?.kind === "message" && event.content, { type: "unsupported", rawType: "sticker" });
  });

  it("extrae los estados de entrega", () => {
    const events = parseWebhook(
      envelope({ ...META, statuses: [{ id: "wamid.5", status: "delivered", timestamp: "1700000001", recipient_id: "549" }] }),
    );
    assert.deepEqual(events, [
      { kind: "status", wamid: "wamid.5", status: "delivered", recipient: "549", timestamp: 1700000001 },
    ]);
  });

  it("ignora cargas inválidas sin lanzar", () => {
    assert.deepEqual(parseWebhook(null), []);
    assert.deepEqual(parseWebhook({ entry: "nada" }), []);
    assert.deepEqual(parseWebhook(envelope({ ...META, messages: [{ id: 1 }] })), []);
  });
});

describe("teléfonos", () => {
  it("normalizePhone deja solo los dígitos", () => {
    assert.equal(normalizePhone("+54 9 11 5555-0101"), "5491155550101");
  });

  it("samePhone compara por los últimos 10 dígitos", () => {
    assert.ok(samePhone("5491155550101", "+54 9 11 5555-0101"));
    assert.ok(samePhone("1155550101", "+54 9 11 5555-0101"));
    assert.equal(samePhone("5491155550102", "+54 9 11 5555-0101"), false);
  });

  it("no empareja números demasiado cortos", () => {
    assert.equal(samePhone("123", "123"), false);
    assert.equal(samePhone("", ""), false);
  });
});

describe("maskSecret", () => {
  it("muestra solo los últimos 4 caracteres de un secreto largo", () => {
    assert.equal(maskSecret("EAAGm0PX4ZCpsBAxyz1234"), "••••1234");
  });

  it("oculta por completo los secretos cortos", () => {
    assert.equal(maskSecret("abc12345"), "••••");
  });

  it("devuelve vacío si no hay secreto", () => {
    assert.equal(maskSecret(null), "");
    assert.equal(maskSecret(undefined), "");
    assert.equal(maskSecret(""), "");
  });
});

describe("createWhatsAppClient", () => {
  const cfg = { accessToken: "TOKEN", phoneNumberId: "PNID" };

  function fakeFetch(response: unknown, status = 200) {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const impl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(response), { status, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    return { impl, calls };
  }

  it("sendText envía el mensaje al número correcto y devuelve el wamid", async () => {
    const { impl, calls } = fakeFetch({ messages: [{ id: "wamid.OUT" }] });
    const wamid = await createWhatsAppClient(cfg, impl).sendText("5491155550101", "Hola");

    assert.equal(wamid, "wamid.OUT");
    assert.match(calls[0]!.url, /\/PNID\/messages$/);
    const headers = calls[0]!.init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer TOKEN");
    assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), {
      messaging_product: "whatsapp",
      to: "5491155550101",
      type: "text",
      text: { body: "Hola", preview_url: false },
    });
  });

  it("exchangeCodeForToken canjea el código de Embedded Signup por el token", async () => {
    const { impl, calls } = fakeFetch({ access_token: "BIZTOKEN" });
    const token = await exchangeCodeForToken({ appId: "APP", appSecret: "SEC", code: "CODE" }, impl);

    assert.equal(token, "BIZTOKEN");
    const url = new URL(calls[0]!.url);
    assert.equal(url.pathname, "/v26.0/oauth/access_token");
    assert.equal(url.searchParams.get("client_id"), "APP");
    assert.equal(url.searchParams.get("client_secret"), "SEC");
    assert.equal(url.searchParams.get("code"), "CODE");
    assert.equal(url.searchParams.has("redirect_uri"), false);
  });

  it("exchangeCodeForToken falla con el mensaje de Meta o si no hay token", async () => {
    const bad = fakeFetch({ error: { message: "Code expired" } }, 400);
    await assert.rejects(
      exchangeCodeForToken({ appId: "A", appSecret: "S", code: "C" }, bad.impl),
      (e: unknown) => e instanceof WhatsAppApiError && e.message === "Code expired",
    );
    const empty = fakeFetch({});
    await assert.rejects(
      exchangeCodeForToken({ appId: "A", appSecret: "S", code: "C" }, empty.impl),
      WhatsAppApiError,
    );
  });

  it("usa la versión v26.0 de la Graph API", async () => {
    const { impl, calls } = fakeFetch({ messages: [{ id: "wamid.V" }] });
    await createWhatsAppClient(cfg, impl).sendText("549", "Hola");
    assert.match(calls[0]!.url, /^https:\/\/graph\.facebook\.com\/v26\.0\//);
  });

  it("getWabaInfo consulta la cuenta de WhatsApp Business", async () => {
    const { impl, calls } = fakeFetch({ id: "WABA", name: "Deli Gastro" });
    const info = await createWhatsAppClient({ ...cfg, wabaId: "WABA" }, impl).getWabaInfo();
    assert.equal(info.name, "Deli Gastro");
    assert.match(calls[0]!.url, /\/WABA\?fields=id,name$/);
  });

  it("isAppSubscribed indica si la app recibe los eventos de la cuenta", async () => {
    const yes = fakeFetch({ data: [{ whatsapp_business_api_data: { id: "APP" } }] });
    assert.equal(await createWhatsAppClient({ ...cfg, wabaId: "WABA" }, yes.impl).isAppSubscribed(), true);
    assert.match(yes.calls[0]!.url, /\/WABA\/subscribed_apps$/);

    const no = fakeFetch({ data: [] });
    assert.equal(await createWhatsAppClient({ ...cfg, wabaId: "WABA" }, no.impl).isAppSubscribed(), false);
  });

  it("subscribeApp suscribe la app a la cuenta con un POST", async () => {
    const { impl, calls } = fakeFetch({ success: true });
    await createWhatsAppClient({ ...cfg, wabaId: "WABA" }, impl).subscribeApp();
    assert.match(calls[0]!.url, /\/WABA\/subscribed_apps$/);
    assert.equal(calls[0]!.init?.method, "POST");
  });

  it("registerPhone registra el número con su PIN de 6 dígitos", async () => {
    const { impl, calls } = fakeFetch({ success: true });
    await createWhatsAppClient(cfg, impl).registerPhone("123456");
    assert.match(calls[0]!.url, /\/PNID\/register$/);
    assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { messaging_product: "whatsapp", pin: "123456" });
  });

  it("registerPhone rechaza un PIN que no sea de 6 dígitos sin llamar a Meta", async () => {
    const { impl, calls } = fakeFetch({ success: true });
    await assert.rejects(createWhatsAppClient(cfg, impl).registerPhone("12ab"), /6 dígitos/);
    assert.equal(calls.length, 0);
  });

  it("las operaciones de la cuenta exigen el WABA ID", async () => {
    const { impl } = fakeFetch({});
    await assert.rejects(createWhatsAppClient(cfg, impl).isAppSubscribed(), /WABA ID/);
  });

  it("sendTemplate arma la plantilla con idioma y variables", async () => {
    const { impl, calls } = fakeFetch({ messages: [{ id: "wamid.T" }] });
    await createWhatsAppClient(cfg, impl).sendTemplate("549", "confirmacion_pedido", "es_AR", ["Juan", "#A1B2"]);

    const body = JSON.parse(String(calls[0]!.init?.body));
    assert.equal(body.type, "template");
    assert.deepEqual(body.template, {
      name: "confirmacion_pedido",
      language: { code: "es_AR" },
      components: [
        { type: "body", parameters: [{ type: "text", text: "Juan" }, { type: "text", text: "#A1B2" }] },
      ],
    });
  });

  it("convierte los errores de la API en WhatsAppApiError con el mensaje de Meta", async () => {
    const { impl } = fakeFetch({ error: { message: "Token inválido", code: 190 } }, 401);
    await assert.rejects(
      createWhatsAppClient(cfg, impl).sendText("549", "Hola"),
      (err: unknown) => err instanceof WhatsAppApiError && err.status === 401 && /Token inválido/.test(err.message),
    );
  });

  it("downloadMedia pide la URL y descarga el archivo con el token", async () => {
    const calls: string[] = [];
    const impl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      if (String(url).endsWith("/MEDIA")) {
        return new Response(JSON.stringify({ url: "https://cdn.example/audio", mime_type: "audio/ogg", file_size: 3 }));
      }
      return new Response(new Uint8Array([1, 2, 3]));
    }) as typeof fetch;

    const media = await createWhatsAppClient(cfg, impl).downloadMedia("MEDIA", 1000);
    assert.equal(media.mimeType, "audio/ogg");
    assert.deepEqual([...new Uint8Array(media.data)], [1, 2, 3]);
    assert.equal(calls[1], "https://cdn.example/audio");
  });

  it("downloadMedia rechaza archivos más grandes que el límite", async () => {
    const impl = (async () =>
      new Response(JSON.stringify({ url: "https://cdn.example/x", mime_type: "audio/ogg", file_size: 5000 }))) as typeof fetch;
    await assert.rejects(createWhatsAppClient(cfg, impl).downloadMedia("MEDIA", 1000), /demasiado grande/i);
  });
});
