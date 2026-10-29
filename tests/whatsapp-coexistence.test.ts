import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { parseCoexistence } from "../src/lib/whatsapp/coexistence.ts";
import { verifySignature } from "../src/lib/whatsapp/signature.ts";
import { handleWebhookEvents, type EntryDeps } from "../workers/whatsapp-bot/src/entry.ts";
import { takeoverMinutesFromConfig } from "../workers/whatsapp-bot/src/bot/settings.ts";
import type { InboundRepo, InboundRow, StoredConversation } from "../workers/whatsapp-bot/src/repo/types.ts";
import type { BufferedMessage } from "../workers/whatsapp-bot/src/batching.ts";
import type { WebhookEvent } from "../src/lib/whatsapp/payload.ts";

const change = (field: string, value: unknown) => ({ entry: [{ id: "WABA", changes: [{ field, value }] }] });
const meta = { phone_number_id: "PN1", display_phone_number: "5491100000000" };

const echoPayload = (id = "e1", timestamp = "1700000000") =>
  change("smb_message_echoes", {
    messaging_product: "whatsapp",
    metadata: meta,
    message_echoes: [{ from: "5491100000000", to: "5491100000001", id, timestamp, type: "text", text: { body: "ya salió" } }],
  });

describe("parseCoexistence", () => {
  it("smb_message_echoes: devuelve el eco con destinatario, texto y número", () => {
    assert.deepEqual(parseCoexistence(echoPayload()), [
      { kind: "smb_echo", wamid: "e1", to: "5491100000001", timestamp: 1_700_000_000, phoneNumberId: "PN1", content: { type: "text", text: "ya salió" } },
    ]);
  });

  it("smb_message_echoes: un tipo no texto queda como unsupported", () => {
    const payload = change("smb_message_echoes", {
      metadata: meta,
      message_echoes: [{ to: "5491100000001", id: "e2", type: "image" }, { id: "sin-to", type: "text" }],
    });
    const events = parseCoexistence(payload);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].kind === "smb_echo" && events[0].content, { type: "unsupported", rawType: "image" });
  });

  it("history: solo conteos, sin contenido", () => {
    const payload = change("history", {
      metadata: meta,
      history: [{ metadata: { phase: 0, chunk_order: 1 }, threads: [{ id: "t", messages: [{ id: "a" }, { id: "b" }] }, { id: "u", messages: [{ id: "c" }] }] }],
    });
    assert.deepEqual(parseCoexistence(payload), [{ kind: "history", phoneNumberId: "PN1", phase: 0, chunk: 1, threads: 2, messages: 3 }]);
  });

  it("smb_app_state_sync: cuenta los contactos", () => {
    const payload = change("smb_app_state_sync", { metadata: meta, state_sync: [{ type: "contact" }, { type: "contact" }] });
    assert.deepEqual(parseCoexistence(payload), [{ kind: "app_state_sync", phoneNumberId: "PN1", contacts: 2 }]);
  });

  it("account_update: solo el nombre del evento", () => {
    assert.deepEqual(parseCoexistence(change("account_update", { phone_number: "549", event: "PARTNER_ADDED" })), [
      { kind: "account_update", event: "PARTNER_ADDED" },
    ]);
  });

  it("payload inválido o campo desconocido se ignora sin lanzar", () => {
    for (const bad of [null, "x", 42, {}, { entry: "x" }, { entry: [{ changes: [{ value: {} }] }] }, change("messages", {}), change("__proto__", {}), change("smb_message_echoes", "x"), change("history", { history: 3 })]) {
      assert.deepEqual(parseCoexistence(bad), []);
    }
  });
});

/** Repo en memoria con la semántica del SQL: la pausa vence con el reloj y nunca se acorta. */
function memoryRepo(now: () => number) {
  const conversations = new Map<string, { id: string; pausedUntil: number }>();
  const messages = new Map<string, { direction: string; body: string | null }>();
  const stored = (phone: string): StoredConversation => {
    const c = conversations.get(phone)!;
    return { id: c.id, phone, humanTakeover: c.pausedUntil > now() };
  };
  const repo: InboundRepo = {
    async upsertConversation(phone) {
      if (!conversations.has(phone)) conversations.set(phone, { id: `c-${phone}`, pausedUntil: 0 });
      return stored(phone);
    },
    async saveInbound(_id, msg: InboundRow) {
      if (messages.has(msg.wamid)) return false;
      messages.set(msg.wamid, { direction: "in", body: msg.body });
      return true;
    },
    async updateStatus() {},
    async pauseBot(phone, until) {
      const c = conversations.get(phone) ?? { id: `c-${phone}`, pausedUntil: 0 };
      conversations.set(phone, { ...c, pausedUntil: Math.max(c.pausedUntil, until.getTime()) });
      return stored(phone);
    },
    async saveEcho(_id, msg) {
      if (messages.has(msg.wamid)) return false;
      messages.set(msg.wamid, { direction: "out", body: msg.body });
      return true;
    },
    async takeoverMinutes() {
      return 120;
    },
  };
  return { repo, conversations, messages };
}

const ECHO_AT = 1_700_000_000;
const buffered: BufferedMessage[] = [];
const depsFor = (repo: InboundRepo, logs: string[] = []): EntryDeps => ({
  repo,
  phoneNumberId: "PN1",
  buffer: async (_phone, message) => {
    buffered.push(message);
  },
  log: (message) => logs.push(message),
});
const text = (wamid: string, timestamp: number): WebhookEvent => ({
  kind: "message", wamid, from: "5491100000001", name: "Ana", timestamp, phoneNumberId: "PN1", content: { type: "text", text: "hola" },
});

describe("eco de la app WhatsApp Business en el Worker", () => {
  it("pausa el bot en ese chat: el siguiente mensaje del cliente se guarda pero no llega al bot", async () => {
    buffered.length = 0;
    const clock = { t: (ECHO_AT + 60) * 1000 };
    const { repo, conversations } = memoryRepo(() => clock.t);
    await handleWebhookEvents(parseCoexistence(echoPayload()), depsFor(repo));
    assert.equal(conversations.get("5491100000001")?.pausedUntil, (ECHO_AT + 120 * 60) * 1000);

    await handleWebhookEvents([text("c1", ECHO_AT + 120)], depsFor(repo));
    assert.equal(buffered.length, 0);

    clock.t = (ECHO_AT + 121 * 60) * 1000; // venció la pausa
    await handleWebhookEvents([text("c2", ECHO_AT + 121 * 60)], depsFor(repo));
    assert.equal(buffered.length, 1);
  });

  it("no responde al eco ni lo apila como mensaje del cliente: queda como saliente", async () => {
    buffered.length = 0;
    const { repo, messages } = memoryRepo(() => ECHO_AT * 1000);
    await handleWebhookEvents(parseCoexistence(echoPayload()), depsFor(repo));
    assert.equal(buffered.length, 0);
    assert.deepEqual(messages.get("e1"), { direction: "out", body: "ya salió" });
  });

  it("ecos duplicados son idempotentes", async () => {
    const { repo, conversations, messages } = memoryRepo(() => ECHO_AT * 1000);
    await handleWebhookEvents(parseCoexistence(echoPayload()), depsFor(repo));
    const first = conversations.get("5491100000001")?.pausedUntil;
    await handleWebhookEvents(parseCoexistence(echoPayload()), depsFor(repo));
    assert.equal(conversations.get("5491100000001")?.pausedUntil, first);
    assert.equal(messages.size, 1);
  });

  it("un eco viejo no acorta una pausa más larga", async () => {
    const { repo, conversations } = memoryRepo(() => ECHO_AT * 1000);
    await handleWebhookEvents(parseCoexistence(echoPayload("e1", String(ECHO_AT + 600))), depsFor(repo));
    await handleWebhookEvents(parseCoexistence(echoPayload("e0", String(ECHO_AT))), depsFor(repo));
    assert.equal(conversations.get("5491100000001")?.pausedUntil, (ECHO_AT + 600 + 120 * 60) * 1000);
  });

  it("ignora ecos de otro número de la misma app", async () => {
    const { repo, conversations } = memoryRepo(() => ECHO_AT * 1000);
    const other = change("smb_message_echoes", {
      metadata: { phone_number_id: "OTRO" },
      message_echoes: [{ to: "5491100000001", id: "x", type: "text", text: { body: "hi" }, timestamp: "1" }],
    });
    await handleWebhookEvents(parseCoexistence(other), depsFor(repo));
    assert.equal(conversations.size, 0);
  });

  it("history, smb_app_state_sync y account_update solo se registran, sin tocar la base", async () => {
    const { repo, conversations, messages } = memoryRepo(() => ECHO_AT * 1000);
    const logs: string[] = [];
    const events = [
      ...parseCoexistence(change("history", { metadata: meta, history: [{ threads: [{ messages: [{}] }] }] })),
      ...parseCoexistence(change("smb_app_state_sync", { metadata: meta, state_sync: [{}] })),
      ...parseCoexistence(change("account_update", { event: "X" })),
    ];
    await handleWebhookEvents(events, depsFor(repo, logs));
    assert.equal(logs.length, 3);
    assert.equal(conversations.size + messages.size, 0);
  });
});

describe("minutos de pausa configurables", () => {
  it("120 por defecto y acepta número o texto; inválidos vuelven al default", () => {
    assert.equal(takeoverMinutesFromConfig({}), 120);
    assert.equal(takeoverMinutesFromConfig({ bot_human_takeover_minutes: 30 }), 30);
    assert.equal(takeoverMinutesFromConfig({ bot_human_takeover_minutes: "45" }), 45);
    for (const bad of [0, -5, "abc", null, NaN, {}]) assert.equal(takeoverMinutesFromConfig({ bot_human_takeover_minutes: bad }), 120);
    assert.equal(takeoverMinutesFromConfig({ bot_human_takeover_minutes: 10 ** 9 }), 7 * 24 * 60);
  });
});

describe("firma del webhook con campos de coexistencia", () => {
  const body = JSON.stringify(echoPayload());
  const sign = (secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  it("acepta la firma correcta y rechaza firma inválida, ajena, vacía o sin secreto", () => {
    assert.equal(verifySignature(body, sign("secreto"), "secreto"), true);
    assert.equal(verifySignature(body, sign("otro"), "secreto"), false);
    assert.equal(verifySignature(body + " ", sign("secreto"), "secreto"), false);
    assert.equal(verifySignature(body, "sha256=zz", "secreto"), false);
    assert.equal(verifySignature(body, null, "secreto"), false);
    assert.equal(verifySignature(body, sign("secreto"), ""), false);
  });
});
