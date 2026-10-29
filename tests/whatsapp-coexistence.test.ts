import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { parseCoexistence } from "../src/lib/whatsapp/coexistence.ts";
import { verifySignature } from "../src/lib/whatsapp/signature.ts";
import { isBotPausedUntil, isBotSilenced } from "../src/lib/whatsapp/pause.ts";
import { attendedLabel, personAttends } from "../src/app/admin/conversaciones/_components/conversation-utils.ts";
import { handleWebhookEvents, type EntryDeps } from "../workers/whatsapp-bot/src/entry.ts";
import { processTurn, type TurnDeps } from "../workers/whatsapp-bot/src/bot/turn.ts";
import { takeoverMinutesFromConfig } from "../workers/whatsapp-bot/src/bot/settings.ts";
import type { BotRepo, InboundRepo, InboundRow, StoredConversation } from "../workers/whatsapp-bot/src/repo/types.ts";
import type { BufferedMessage } from "../workers/whatsapp-bot/src/batching.ts";
import type { WebhookEvent } from "../src/lib/whatsapp/payload.ts";

const change = (field: string, value: unknown) => ({ entry: [{ id: "WABA", changes: [{ field, value }] }] });
const meta = { phone_number_id: "PN1", display_phone_number: "5491100000000" };

const echoItem = (extra: Record<string, unknown> = {}) => ({
  from: "5491100000000", to: "5491100000001", id: "e1", timestamp: "1700000000", type: "text", text: { body: "ya salió" }, ...extra,
});
const echoPayload = (extra: Record<string, unknown> = {}) =>
  change("smb_message_echoes", { messaging_product: "whatsapp", metadata: meta, message_echoes: [echoItem(extra)] });

describe("parseCoexistence", () => {
  it("smb_message_echoes: devuelve el eco con destinatario, texto y número", () => {
    assert.deepEqual(parseCoexistence(echoPayload()), [
      { kind: "smb_echo", wamid: "e1", to: "5491100000001", timestamp: 1_700_000_000, phoneNumberId: "PN1", content: { type: "text", text: "ya salió" } },
    ]);
  });

  it("media: image/video/document llevan su tipo real y una etiqueta; edit y revoke quedan como ignorados", () => {
    const content = (type: string) => {
      const [event] = parseCoexistence(echoPayload({ type, text: undefined }));
      return event.kind === "smb_echo" ? event.content : null;
    };
    assert.deepEqual(content("image"), { type: "media", mediaType: "image", label: "[imagen]" });
    assert.deepEqual(content("video"), { type: "media", mediaType: "video", label: "[video]" });
    assert.deepEqual(content("document"), { type: "media", mediaType: "document", label: "[documento]" });
    assert.deepEqual(content("edit"), { type: "ignored", rawType: "edit" });
    assert.deepEqual(content("revoke"), { type: "ignored", rawType: "revoke" });
    assert.deepEqual(content("sticker"), { type: "unsupported", rawType: "sticker" });
  });

  it("timestamp: acepta texto o número; si no parsea queda en 0 y el eco no se descarta", () => {
    const at = (timestamp: unknown) => {
      const [event] = parseCoexistence(echoPayload({ timestamp }));
      return event.kind === "smb_echo" ? event.timestamp : -1;
    };
    assert.equal(at("1700000000"), 1_700_000_000);
    assert.equal(at(1_700_000_000), 1_700_000_000);
    assert.equal(at("no-es-fecha"), 0);
    assert.equal(at(undefined), 0);
  });

  it("smb_message_echoes: un item sin destinatario se descarta, el resto sigue", () => {
    const payload = change("smb_message_echoes", { metadata: meta, message_echoes: [{ id: "sin-to", type: "text" }, echoItem({ id: "ok" })] });
    assert.equal(parseCoexistence(payload).length, 1);
  });

  it("history: solo conteos, sin contenido", () => {
    const payload = change("history", {
      metadata: meta,
      history: [{ metadata: { phase: 0, chunk_order: 1 }, threads: [{ id: "t", messages: [{ id: "a" }, { id: "b" }] }, { id: "u", messages: [{ id: "c" }] }] }],
    });
    assert.deepEqual(parseCoexistence(payload), [
      { kind: "history", phoneNumberId: "PN1", phase: 0, chunk: 1, threads: 2, messages: 3, errorCode: null, rejected: false },
    ]);
  });

  it("history rechazado (errors, código 2593109) se distingue de un lote vacío", () => {
    const rejected = parseCoexistence(change("history", { metadata: meta, history: [{ errors: [{ code: 2593109, title: "x" }] }] }));
    assert.deepEqual(rejected, [{ kind: "history", phoneNumberId: "PN1", phase: null, chunk: null, threads: 0, messages: 0, errorCode: 2593109, rejected: true }]);
    const empty = parseCoexistence(change("history", { metadata: meta, history: [{ metadata: { phase: 1, chunk_order: 1 }, threads: [] }] }));
    assert.equal(empty[0].kind === "history" && empty[0].rejected, false);
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

const T0 = 1_700_000_000_000;

/** Repo en memoria con la semántica del SQL: últimos 10 dígitos, pausa que vence con el reloj y que nunca se acorta. */
function memoryRepo(clock: { t: number }) {
  const conversations = new Map<string, { id: string; phone: string; pausedUntil: number }>();
  const messages = new Map<string, { direction: string; type: string; body: string | null }>();
  const calls = { minutes: 0, order: [] as string[] };
  const stored = (c: { id: string; phone: string; pausedUntil: number }): StoredConversation => ({ id: c.id, phone: c.phone, humanTakeover: c.pausedUntil > clock.t });
  const byTail = (phone: string) => [...conversations.values()].find((c) => c.phone.slice(-10) === phone.slice(-10));
  const repo: InboundRepo = {
    async upsertConversation(phone) {
      const found = byTail(phone) ?? { id: `c-${phone}`, phone, pausedUntil: 0 };
      conversations.set(found.phone, found);
      return stored(found);
    },
    async saveInbound(_id, msg: InboundRow) {
      if (messages.has(msg.wamid)) return false;
      messages.set(msg.wamid, { direction: "in", type: msg.type, body: msg.body });
      return true;
    },
    async updateStatus() {},
    async hasOutbound(wamid) {
      return messages.get(wamid)?.direction === "out";
    },
    async ensureConversation(phone) {
      const found = byTail(phone) ?? { id: `c-${phone}`, phone, pausedUntil: 0 };
      conversations.set(found.phone, found);
      return stored(found);
    },
    async pauseBot(conversationId, until) {
      calls.order.push("pause");
      const c = [...conversations.values()].find((x) => x.id === conversationId)!;
      c.pausedUntil = Math.max(c.pausedUntil, until.getTime());
    },
    async saveEcho(_id, msg) {
      calls.order.push("save");
      if (messages.has(msg.wamid)) return false;
      messages.set(msg.wamid, { direction: "out", type: msg.type, body: msg.body });
      return true;
    },
    async takeoverMinutes() {
      calls.minutes += 1;
      return 120;
    },
  };
  return { repo, conversations, messages, calls };
}

const buffered: BufferedMessage[] = [];
function depsFor(repo: InboundRepo, clock: { t: number }, logs: string[] = [], phoneNumberId: string | null = "PN1"): EntryDeps {
  return {
    repo,
    phoneNumberId,
    buffer: async (_phone, message) => {
      buffered.push(message);
    },
    log: (message) => logs.push(message),
    now: () => clock.t,
  };
}
const text = (wamid: string, timestamp: number): WebhookEvent => ({
  kind: "message", wamid, from: "5491100000001", name: "Ana", timestamp, phoneNumberId: "PN1", content: { type: "text", text: "hola" },
});
const PHONE = "5491100000001";

describe("eco de la app WhatsApp Business en el Worker", () => {
  it("pausa el bot en ese chat: el mensaje del cliente se guarda pero no llega al bot, y vuelve al vencer", async () => {
    buffered.length = 0;
    const clock = { t: T0 + 60_000 };
    const { repo, conversations } = memoryRepo(clock);
    await handleWebhookEvents(parseCoexistence(echoPayload()), depsFor(repo, clock));
    assert.equal(conversations.get(PHONE)?.pausedUntil, T0 + 120 * 60_000);

    await handleWebhookEvents([text("c1", 1_700_000_120)], depsFor(repo, clock));
    assert.equal(buffered.length, 0);

    clock.t = T0 + 121 * 60_000;
    await handleWebhookEvents([text("c2", 1_700_007_260)], depsFor(repo, clock));
    assert.equal(buffered.length, 1);
  });

  it("no responde al eco ni lo apila: queda como saliente", async () => {
    buffered.length = 0;
    const clock = { t: T0 };
    const { repo, messages } = memoryRepo(clock);
    await handleWebhookEvents(parseCoexistence(echoPayload()), depsFor(repo, clock));
    assert.equal(buffered.length, 0);
    assert.deepEqual(messages.get("e1"), { direction: "out", type: "text", body: "ya salió" });
  });

  it("media se guarda con su tipo y etiqueta (body nunca null) y pausa", async () => {
    const clock = { t: T0 };
    const { repo, messages, conversations } = memoryRepo(clock);
    await handleWebhookEvents(parseCoexistence(echoPayload({ type: "image", text: undefined })), depsFor(repo, clock));
    assert.deepEqual(messages.get("e1"), { direction: "out", type: "image", body: "[imagen]" });
    assert.ok((conversations.get(PHONE)?.pausedUntil ?? 0) > T0);
  });

  it("edit y revoke no se guardan ni pausan", async () => {
    const clock = { t: T0 };
    const { repo, messages, conversations } = memoryRepo(clock);
    const logs: string[] = [];
    for (const type of ["edit", "revoke"]) {
      await handleWebhookEvents(parseCoexistence(echoPayload({ id: type, type, text: undefined })), depsFor(repo, clock, logs));
    }
    assert.equal(messages.size + conversations.size, 0);
    assert.equal(logs.length, 2);
  });

  it("ecos duplicados son idempotentes y no vuelven a pausar", async () => {
    const clock = { t: T0 };
    const { repo, conversations, messages, calls } = memoryRepo(clock);
    await handleWebhookEvents(parseCoexistence(echoPayload()), depsFor(repo, clock));
    const first = conversations.get(PHONE)?.pausedUntil;
    await handleWebhookEvents(parseCoexistence(echoPayload()), depsFor(repo, clock));
    assert.equal(conversations.get(PHONE)?.pausedUntil, first);
    assert.equal(messages.size, 1);
    assert.equal(calls.order.filter((c) => c === "pause").length, 1);
  });

  it("un wamid que ya existe como saliente (lo mandó el propio bot) no pausa", async () => {
    const clock = { t: T0 };
    const { repo, conversations, messages } = memoryRepo(clock);
    const conversation = await repo.ensureConversation(PHONE);
    messages.set("e1", { direction: "out", type: "text", body: "respuesta del bot" });
    await handleWebhookEvents(parseCoexistence(echoPayload()), depsFor(repo, clock));
    assert.equal(conversations.get(PHONE)?.pausedUntil, 0);
    assert.equal(conversation.humanTakeover, false);
  });

  it("guarda el eco antes de pausar y consulta los minutos una sola vez por payload", async () => {
    const clock = { t: T0 };
    const { repo, calls } = memoryRepo(clock);
    const two = change("smb_message_echoes", { metadata: meta, message_echoes: [echoItem({ id: "a" }), echoItem({ id: "b" })] });
    await handleWebhookEvents(parseCoexistence(two), depsFor(repo, clock));
    assert.deepEqual(calls.order, ["save", "pause", "save", "pause"]);
    assert.equal(calls.minutes, 1);
  });

  it("un eco viejo no acorta una pausa más larga", async () => {
    const clock = { t: T0 + 3_600_000 };
    const { repo, conversations } = memoryRepo(clock);
    await handleWebhookEvents(parseCoexistence(echoPayload({ id: "e1", timestamp: String(1_700_000_600) })), depsFor(repo, clock));
    await handleWebhookEvents(parseCoexistence(echoPayload({ id: "e0", timestamp: String(1_700_000_000) })), depsFor(repo, clock));
    assert.equal(conversations.get(PHONE)?.pausedUntil, (1_700_000_600 + 120 * 60) * 1000);
  });

  it("acota la fecha a la hora actual y descarta fechas a más de 5 minutos en el futuro", async () => {
    const clock = { t: T0 };
    const slight = memoryRepo(clock);
    await handleWebhookEvents(parseCoexistence(echoPayload({ timestamp: String(1_700_000_120) })), depsFor(slight.repo, clock));
    assert.equal(slight.conversations.get(PHONE)?.pausedUntil, T0 + 120 * 60_000);

    const far = memoryRepo(clock);
    const logs: string[] = [];
    await handleWebhookEvents(parseCoexistence(echoPayload({ timestamp: String(1_700_001_000) })), depsFor(far.repo, clock, logs));
    assert.equal(far.messages.size + far.conversations.size, 0);
    assert.equal(logs.length, 1);
  });

  it("sin fecha legible usa la hora actual y no descarta el eco", async () => {
    const clock = { t: T0 };
    const { repo, conversations } = memoryRepo(clock);
    await handleWebhookEvents(parseCoexistence(echoPayload({ timestamp: "basura" })), depsFor(repo, clock));
    assert.equal(conversations.get(PHONE)?.pausedUntil, T0 + 120 * 60_000);
  });

  it("falla cerrado: sin número configurado, con otro número o con destinatario corto se ignora sin PII", async () => {
    const clock = { t: T0 };
    const cases: [string | null, Record<string, unknown>][] = [[null, {}], ["OTRO", {}], ["PN1", { to: "123" }]];
    for (const [configured, extra] of cases) {
      const { repo, conversations, messages } = memoryRepo(clock);
      const logs: string[] = [];
      await handleWebhookEvents(parseCoexistence(echoPayload(extra)), depsFor(repo, clock, logs, configured));
      assert.equal(conversations.size + messages.size, 0);
      assert.equal(logs.length, 1);
      assert.ok(!logs[0].includes(PHONE));
    }
  });

  it("encuentra la conversación existente aunque el prefijo cambie (549... vs 54...)", async () => {
    const clock = { t: T0 };
    const { repo, conversations } = memoryRepo(clock);
    await repo.upsertConversation("5491100000001", null);
    await handleWebhookEvents(parseCoexistence(echoPayload({ to: "541100000001" })), depsFor(repo, clock));
    assert.equal(conversations.size, 1);
    assert.ok((conversations.get("5491100000001")?.pausedUntil ?? 0) > 0);
  });

  it("los ecos se procesan antes que los mensajes del mismo payload", async () => {
    buffered.length = 0;
    const clock = { t: T0 };
    const { repo } = memoryRepo(clock);
    const events = [text("c1", 1_700_000_000), ...parseCoexistence(echoPayload())];
    await handleWebhookEvents(events, depsFor(repo, clock));
    assert.equal(buffered.length, 0);
  });

  it("history, smb_app_state_sync y account_update solo se registran, sin tocar la base", async () => {
    const clock = { t: T0 };
    const { repo, conversations, messages } = memoryRepo(clock);
    const logs: string[] = [];
    const events = [
      ...parseCoexistence(change("history", { metadata: meta, history: [{ threads: [{ messages: [{}] }] }] })),
      ...parseCoexistence(change("history", { metadata: meta, history: [{ errors: [{ code: 2593109 }] }] })),
      ...parseCoexistence(change("smb_app_state_sync", { metadata: meta, state_sync: [{}] })),
      ...parseCoexistence(change("account_update", { event: "X" })),
    ];
    await handleWebhookEvents(events, depsFor(repo, clock, logs));
    assert.deepEqual(logs, [
      "[whatsapp-bot] history ignorado",
      "[whatsapp-bot] history rechazado por el usuario",
      "[whatsapp-bot] smb_app_state_sync ignorado",
      "[whatsapp-bot] account_update",
    ]);
    assert.equal(conversations.size + messages.size, 0);
  });

  it("PARTNER_REMOVED, ACCOUNT_OFFBOARDED y ACCOUNT_RECONNECTED se registran como alerta", async () => {
    const clock = { t: T0 };
    const { repo } = memoryRepo(clock);
    const logs: string[] = [];
    for (const event of ["PARTNER_REMOVED", "ACCOUNT_OFFBOARDED", "ACCOUNT_RECONNECTED"]) {
      await handleWebhookEvents(parseCoexistence(change("account_update", { event })), depsFor(repo, clock, logs));
    }
    assert.equal(logs.length, 3);
    assert.ok(logs.every((l) => l.includes("ALERTA")));
  });
});

describe("turno: re-chequeo de la pausa antes de enviar", () => {
  it("si un eco pausa el chat mientras el modelo piensa, no se envía nada", async () => {
    const state = { takeover: false, saved: 0, sent: 0 };
    const repo: BotRepo = {
      getConversation: async (phone) => ({ id: "c1", phone, clientId: null, displayName: null, humanTakeover: state.takeover }),
      history: async () => [{ direction: "in", body: "hola" }],
      inboundCounts: async () => ({ lastMinute: 1, lastDay: 1 }),
      config: async () => ({ agente_activo: true, horario_apertura: "00:00", horario_cierre: "23:59" }),
      menu: async () => [],
      zones: async () => [],
      latestOrder: async () => null,
      setTakeover: async () => {},
      setMarketingOptIn: async () => 0,
      saveOutbound: async () => { state.saved += 1; },
      saveTranscript: async () => {},
    };
    const run: TurnDeps["run"] = async (_model, input) => {
      state.takeover = true; // llega el eco mientras se clasifica
      return "response_format" in input ? { response: JSON.stringify({ intent: "saludo", confidence: 1 }) } : { response: "hola!" };
    };
    const deps: TurnDeps = { repo, run, transcribe: async () => "", send: async () => { state.sent += 1; return "w"; }, appUrl: "https://x", log: () => {} };
    const outcome = await processTurn({ phone: PHONE, text: "hola", wamids: ["w1"], audios: [], receivedAt: 0 }, deps);
    assert.equal(outcome, "takeover");
    assert.equal(state.sent + state.saved, 0);
  });
});

describe("pausa en el panel y en el servidor", () => {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const past = new Date(Date.now() - 3_600_000).toISOString();

  it("isBotPausedUntil / isBotSilenced respetan la fecha y human_takeover", () => {
    assert.equal(isBotPausedUntil(future), true);
    assert.equal(isBotPausedUntil(past), false);
    assert.equal(isBotPausedUntil(null), false);
    assert.equal(isBotPausedUntil("basura"), false);
    assert.equal(isBotSilenced({ human_takeover: false, bot_paused_until: future }), true);
    assert.equal(isBotSilenced({ human_takeover: false, bot_paused_until: past }), false);
    assert.equal(isBotSilenced({ human_takeover: true }), true);
  });

  it("el panel muestra «Bot en pausa hasta HH:MM» aunque human_takeover sea false", () => {
    const c = { humanTakeover: false, botPausedUntil: future };
    assert.equal(personAttends(c, Date.now()), true);
    assert.match(attendedLabel(c, Date.now()), /^Bot en pausa hasta \d{2}:\d{2}$/);
    assert.equal(attendedLabel({ humanTakeover: false, botPausedUntil: past }, Date.now()), "Responde el agente");
    assert.match(attendedLabel({ humanTakeover: true }, Date.now()), /^Atiende una persona/);
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
