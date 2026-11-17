import { test } from "node:test";
import assert from "node:assert/strict";
import { argentinaWithoutNine, createWhatsAppClient, WhatsAppApiError } from "../src/lib/whatsapp/client.ts";

const NOT_ALLOWED = { error: { message: "(#131030) Recipient phone number not in allowed list", code: 131030 } };

function fakeFetch(handler: (to: string) => { status: number; body: unknown }) {
  const calls: string[] = [];
  const impl = (async (_url: string, init?: RequestInit) => {
    const to = JSON.parse(String(init?.body)).to as string;
    calls.push(to);
    const { status, body } = handler(to);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const ok = { status: 200, body: { messages: [{ id: "wamid.1" }] } };

test("argentinaWithoutNine solo convierte celulares 549 + 10 dígitos", () => {
  assert.equal(argentinaWithoutNine("5491156194690"), "541156194690");
  assert.equal(argentinaWithoutNine("541156194690"), null);
  assert.equal(argentinaWithoutNine("5215512345678"), null);
  assert.equal(argentinaWithoutNine("54911561946"), null);
});

test("si Meta rechaza 549… por lista de permitidos, reintenta sin el 9", async () => {
  const { impl, calls } = fakeFetch((to) => (to.startsWith("549") ? { status: 400, body: NOT_ALLOWED } : ok));
  const wa = createWhatsAppClient({ accessToken: "t", phoneNumberId: "p" }, impl);
  assert.equal(await wa.sendText("5491156194690", "hola"), "wamid.1");
  assert.deepEqual(calls, ["5491156194690", "541156194690"]);
});

test("con el 9 aceptado no hay segundo envío", async () => {
  const { impl, calls } = fakeFetch(() => ok);
  const wa = createWhatsAppClient({ accessToken: "t", phoneNumberId: "p" }, impl);
  await wa.sendText("5491156194690", "hola");
  assert.deepEqual(calls, ["5491156194690"]);
});

test("otros errores no se reintentan", async () => {
  const { impl, calls } = fakeFetch(() => ({ status: 400, body: { error: { message: "(#100) Invalid parameter" } } }));
  const wa = createWhatsAppClient({ accessToken: "t", phoneNumberId: "p" }, impl);
  await assert.rejects(wa.sendText("5491156194690", "hola"), WhatsAppApiError);
  assert.deepEqual(calls, ["5491156194690"]);
});

test("números de otros países no se tocan", async () => {
  const { impl, calls } = fakeFetch(() => ({ status: 400, body: NOT_ALLOWED }));
  const wa = createWhatsAppClient({ accessToken: "t", phoneNumberId: "p" }, impl);
  await assert.rejects(wa.sendText("15551958047", "hola"), WhatsAppApiError);
  assert.deepEqual(calls, ["15551958047"]);
});
