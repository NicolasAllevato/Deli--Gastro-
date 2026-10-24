import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  OpenWAApiError,
  chatIdFor,
  createOpenWAClient,
  isOpenWAProvider,
  openwaConfigFromEnv,
  parseOpenWAWebhook,
} from "../src/lib/whatsapp/openwa.ts";
import { verifySignature } from "../src/lib/whatsapp/signature.ts";

const received = (data: Record<string, unknown>) => ({
  event: "message.received",
  timestamp: "2026-10-23T22:00:00.000Z",
  sessionId: "dely",
  idempotencyKey: "msg_dely_X",
  deliveryId: "dlv_1",
  data: { id: "3EB0A1", from: "5491155550101@c.us", chatId: "5491155550101@c.us", body: "Hola", type: "text", timestamp: 1786000000, fromMe: false, kind: "individual", ...data },
});

test("config: necesita URL, API key y sesión; recorta la barra final", () => {
  assert.equal(openwaConfigFromEnv({ OPENWA_URL: "https://wa.x", OPENWA_API_KEY: "k" }), null);
  assert.deepEqual(
    openwaConfigFromEnv({ OPENWA_URL: "https://wa.x/", OPENWA_API_KEY: " k ", OPENWA_SESSION_ID: "dely" }),
    { url: "https://wa.x", apiKey: "k", sessionId: "dely" },
  );
});

test("proveedor: solo WHATSAPP_PROVIDER=openwa activa OpenWA", () => {
  assert.equal(isOpenWAProvider({ WHATSAPP_PROVIDER: "OpenWA" }), true);
  assert.equal(isOpenWAProvider({ WHATSAPP_PROVIDER: "meta" }), false);
  assert.equal(isOpenWAProvider({}), false);
});

test("chatIdFor: deja solo dígitos y agrega @c.us", () => {
  assert.equal(chatIdFor("+54 9 11 5555-0101"), "5491155550101@c.us");
});

test("message.received de texto → mensaje común con nombre y sesión", () => {
  const [event] = parseOpenWAWebhook(received({ contact: { name: null, pushName: "Ana" } }));
  assert.deepEqual(event, {
    kind: "message",
    wamid: "3EB0A1",
    from: "5491155550101",
    name: "Ana",
    timestamp: 1786000000,
    phoneNumberId: "dely",
    content: { type: "text", text: "Hola" },
  });
});

test("Baileys: acepta @s.whatsapp.net y prefiere senderPhone sobre un @lid", () => {
  const [a] = parseOpenWAWebhook(received({ from: "5491155550101@s.whatsapp.net", chatId: "5491155550101@s.whatsapp.net" }));
  assert.equal(a.kind === "message" && a.from, "5491155550101");
  const [b] = parseOpenWAWebhook(received({ from: "123456@lid", chatId: "123456@lid", senderPhone: "+5491155550202" }));
  assert.equal(b.kind === "message" && b.from, "5491155550202");
});

test("se descartan: @lid sin teléfono, grupos, propios y otros eventos", () => {
  assert.deepEqual(parseOpenWAWebhook(received({ from: "123456@lid", chatId: "123456@lid" })), []);
  assert.deepEqual(parseOpenWAWebhook(received({ kind: "group", chatId: "1203630@g.us" })), []);
  assert.deepEqual(parseOpenWAWebhook(received({ fromMe: true })), []);
  assert.deepEqual(parseOpenWAWebhook({ event: "session.qr", sessionId: "dely", data: {} }), []);
  assert.deepEqual(parseOpenWAWebhook({ nada: true }), []);
});

test("tipos que no son texto quedan como no soportados", () => {
  const [event] = parseOpenWAWebhook(received({ type: "voice", body: "" }));
  assert.deepEqual(event.kind === "message" && event.content, { type: "unsupported", rawType: "voice" });
});

test("message.ack → estado de entrega; pending se ignora", () => {
  const ack = (status: string) => ({ event: "message.ack", sessionId: "dely", data: { id: "m1", messageId: "m1", status, chatId: "5491155550101@c.us" } });
  assert.deepEqual(parseOpenWAWebhook(ack("read")), [
    { kind: "status", wamid: "m1", status: "read", recipient: "5491155550101", timestamp: 0 },
  ]);
  assert.deepEqual(parseOpenWAWebhook(ack("pending")), []);
});

test("la firma de OpenWA se valida con el mismo verificador HMAC", () => {
  const raw = JSON.stringify(received({}));
  const header = `sha256=${createHmac("sha256", "s3cr3t").update(raw).digest("hex")}`;
  assert.equal(verifySignature(raw, header, "s3cr3t"), true);
  assert.equal(verifySignature(raw, header, "otro"), false);
});

const cfg = { url: "https://wa.x", apiKey: "k", sessionId: "dely" };

test("sendText: manda chatId y texto con la API key y devuelve el id", async () => {
  let call: { url: string; init: RequestInit } | null = null;
  const fake = (async (url: string, init: RequestInit) => {
    call = { url, init };
    return new Response(JSON.stringify({ messageId: "true_549@c.us_ABC", timestamp: 1 }), { status: 201 });
  }) as unknown as typeof fetch;

  const id = await createOpenWAClient(cfg, fake).sendText("+54 9 11 5555-0101", "Hola");
  assert.equal(id, "true_549@c.us_ABC");
  assert.equal(call!.url, "https://wa.x/api/sessions/dely/messages/send-text");
  assert.equal((call!.init.headers as Record<string, string>)["X-API-Key"], "k");
  assert.deepEqual(JSON.parse(call!.init.body as string), { chatId: "5491155550101@c.us", text: "Hola" });
});

test("sendText: un error de OpenWA llega con su mensaje y estado", async () => {
  const fake = (async () =>
    new Response(JSON.stringify({ message: "Session not active" }), { status: 409 })) as unknown as typeof fetch;
  await assert.rejects(createOpenWAClient(cfg, fake).sendText("549", "x"), (e: unknown) =>
    e instanceof OpenWAApiError && e.status === 409 && e.message === "Session not active");
});

/** OpenWA falso: responde por método + ruta y anota cada llamada. */
function fakeOpenWA(routes: Record<string, Array<() => Response>>) {
  const calls: string[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${new URL(url).pathname}`;
    calls.push(key);
    const queue = routes[key];
    if (!queue?.length) throw new Error(`ruta inesperada: ${key}`);
    return (queue.length > 1 ? queue.shift()! : queue[0])();
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });
const SESSION = "GET /api/sessions/dely";
const START = "POST /api/sessions/dely/start";
const AUDIT = "GET /api/audit";
const audit = (...actions: string[]) => json({ data: actions.map(action => ({ action, sessionId: "dely" })) });
const SEND = "POST /api/sessions/dely/messages/send-text";
const fast = { pollMs: 1, maxWaitMs: 50 };

test("ensureActive: con la sesión lista no hace nada más", async () => {
  const wa = fakeOpenWA({ [SESSION]: [json({ status: "ready" })] });
  assert.equal(await createOpenWAClient(cfg, wa.impl).ensureActive(fast), true);
  assert.deepEqual(wa.calls, [SESSION]);
});

test("ensureActive: una sesión desconectada se arranca y se espera hasta ready", async () => {
  const wa = fakeOpenWA({
    [SESSION]: [json({ status: "disconnected" }), json({ status: "initializing" }), json({ status: "ready" })],
    [AUDIT]: [audit("session_started", "session_qr_generated")],
    [START]: [json({ status: "initializing" }, 201)],
  });
  assert.equal(await createOpenWAClient(cfg, wa.impl).ensureActive(fast), true);
  assert.deepEqual(wa.calls, [SESSION, AUDIT, START, SESSION, SESSION]);
});

test("ensureActive: una sesión frenada a mano (último evento session_stopped) no se vuelve a arrancar", async () => {
  const wa = fakeOpenWA({
    [SESSION]: [json({ status: "disconnected" })],
    [AUDIT]: [json({ data: [{ action: "session_stopped", sessionId: "otra" }, { action: "session_stopped", sessionId: "dely" }, { action: "session_started", sessionId: "dely" }] })],
  });
  assert.equal(await createOpenWAClient(cfg, wa.impl).ensureActive(fast), false);
  assert.deepEqual(wa.calls, [SESSION, AUDIT]);
});

test("ensureActive: si la auditoría no responde, ante la duda no se arranca", async () => {
  const wa = fakeOpenWA({ [SESSION]: [json({ status: "disconnected" })], [AUDIT]: [json({ message: "Forbidden" }, 403)] });
  assert.equal(await createOpenWAClient(cfg, wa.impl).ensureActive(fast), false);
  assert.deepEqual(wa.calls, [SESSION, AUDIT]);
});

test("ensureActive: failed o qr necesitan a una persona, no se arrancan", async () => {
  for (const status of ["failed", "qr_ready"]) {
    const wa = fakeOpenWA({ [SESSION]: [json({ status })] });
    assert.equal(await createOpenWAClient(cfg, wa.impl).ensureActive(fast), false);
    assert.deepEqual(wa.calls, [SESSION]);
  }
});

test("sendText: si la sesión no está activa la arranca y reintenta una vez", async () => {
  const wa = fakeOpenWA({
    [SEND]: [json({ message: "Session 'dely' is not active. Start the session first" }, 409), json({ messageId: "m2" }, 201)],
    [SESSION]: [json({ status: "disconnected" }), json({ status: "ready" })],
    [AUDIT]: [audit("session_started")],
    [START]: [json({}, 201)],
  });
  const client = createOpenWAClient(cfg, wa.impl, fast);
  assert.equal(await client.sendText("549", "Hola"), "m2");
  assert.deepEqual(wa.calls, [SEND, SESSION, AUDIT, START, SESSION, SEND]);
});

const sent = (data: Record<string, unknown>) => ({
  event: "message.sent",
  sessionId: "dely",
  data: { id: "3EB0B2", from: "5491127744537@s.whatsapp.net", to: "5491155550101@s.whatsapp.net", chatId: "5491155550101@s.whatsapp.net", body: "Ya sale tu pedido", type: "text", timestamp: 1786000100, fromMe: true, ...data },
});

test("message.sent (respuesta desde el teléfono o la API) → eco saliente al cliente del chat", () => {
  assert.deepEqual(parseOpenWAWebhook(sent({})), [{
    kind: "echo",
    wamid: "3EB0B2",
    to: "5491155550101",
    timestamp: 1786000100,
    phoneNumberId: "dely",
    content: { type: "text", text: "Ya sale tu pedido" },
  }]);
});

test("message.sent: grupos, @lid sin teléfono y estados no entran", () => {
  assert.deepEqual(parseOpenWAWebhook(sent({ chatId: "1203630@g.us", to: "1203630@g.us" })), []);
  assert.deepEqual(parseOpenWAWebhook(sent({ chatId: "123456@lid", to: "123456@lid" })), []);
  assert.deepEqual(parseOpenWAWebhook(sent({ chatId: "status@broadcast", to: "status@broadcast" })), []);
});
