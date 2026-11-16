import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleWebhookEvents, type EntryDeps } from "../workers/whatsapp-bot/src/entry.ts";
import type { InboundRepo, StoredConversation } from "../workers/whatsapp-bot/src/repo/types.ts";
import type { BufferedMessage } from "../workers/whatsapp-bot/src/batching.ts";
import type { WebhookEvent } from "../src/lib/whatsapp/payload.ts";

/** Repo en memoria con el mismo contrato que el de SQL. */
function memoryRepo(initial: { takeover?: boolean } = {}) {
  const conversations = new Map<string, StoredConversation>();
  const messages = new Map<string, { conversationId: string; direction: string; type: string; body: string | null; status: string | null }>();
  const repo: InboundRepo = {
    async upsertConversation(phone, name) {
      const found = conversations.get(phone);
      if (found) return found;
      const created = { id: `c-${phone}`, phone, humanTakeover: initial.takeover ?? false };
      conversations.set(phone, created);
      void name;
      return created;
    },
    async saveInbound(conversationId, msg) {
      if (messages.has(msg.wamid)) return false;
      messages.set(msg.wamid, { conversationId, direction: "in", type: msg.type, body: msg.body, status: null });
      return true;
    },
    async updateStatus(wamid, status) {
      const row = messages.get(wamid);
      if (row) row.status = status;
    },
    async hasOutbound() {
      throw new Error("no se usa en estos tests");
    },
    async ensureConversation() {
      throw new Error("no se usa en estos tests");
    },
    async pauseBot(): Promise<number> {
      throw new Error("no se usa en estos tests");
    },
    async saveEcho() {
      throw new Error("no se usa en estos tests");
    },
    async takeoverMinutes() {
      return 120;
    },
  };
  return { repo, conversations, messages };
}

function deps(repo: InboundRepo, buffered: { phone: string; message: BufferedMessage }[]): EntryDeps {
  return {
    repo,
    phoneNumberId: "PN1",
    buffer: async (phone, message) => {
      buffered.push({ phone, message });
    },
    log: () => {},
  };
}

const text = (wamid: string, body: string, from = "5491100000001", phoneNumberId = "PN1"): WebhookEvent => ({
  kind: "message",
  wamid,
  from,
  name: "Ana",
  timestamp: 1_700_000_000,
  phoneNumberId,
  content: { type: "text", text: body },
});

describe("entrada del webhook en el Worker", () => {
  it("guarda el mensaje (para verlo en el panel) y lo manda al apilador", async () => {
    const { repo, messages } = memoryRepo();
    const buffered: { phone: string; message: BufferedMessage }[] = [];
    await handleWebhookEvents([text("w1", "hola")], deps(repo, buffered));
    assert.equal(messages.get("w1")?.body, "hola");
    assert.equal(buffered.length, 1);
    assert.equal(buffered[0].phone, "5491100000001");
    assert.equal(buffered[0].message.text, "hola");
    assert.equal(buffered[0].message.at, 1_700_000_000_000);
  });

  it("no procesa dos veces el mismo wamid (reintentos de Meta)", async () => {
    const { repo } = memoryRepo();
    const buffered: { phone: string; message: BufferedMessage }[] = [];
    await handleWebhookEvents([text("w1", "hola")], deps(repo, buffered));
    await handleWebhookEvents([text("w1", "hola")], deps(repo, buffered));
    assert.equal(buffered.length, 1);
  });

  it("ignora mensajes de otro número de la misma app", async () => {
    const { repo, messages } = memoryRepo();
    const buffered: { phone: string; message: BufferedMessage }[] = [];
    await handleWebhookEvents([text("w1", "hola", "5491100000001", "OTRO")], deps(repo, buffered));
    assert.equal(messages.size, 0);
    assert.equal(buffered.length, 0);
  });

  it("con un humano a cargo guarda el mensaje pero el bot no lo toma", async () => {
    const { repo, messages } = memoryRepo({ takeover: true });
    const buffered: { phone: string; message: BufferedMessage }[] = [];
    await handleWebhookEvents([text("w1", "hola")], deps(repo, buffered));
    assert.equal(messages.size, 1);
    assert.equal(buffered.length, 0);
  });

  it("los audios van al apilador con su mediaId para transcribirlos después", async () => {
    const { repo, messages } = memoryRepo();
    const buffered: { phone: string; message: BufferedMessage }[] = [];
    const audio: WebhookEvent = {
      kind: "message", wamid: "a1", from: "5491100000001", name: null, timestamp: 1, phoneNumberId: "PN1",
      content: { type: "audio", mediaId: "m-9", mimeType: "audio/ogg" },
    };
    await handleWebhookEvents([audio], deps(repo, buffered));
    assert.equal(messages.get("a1")?.type, "audio");
    assert.deepEqual(buffered[0].message, { wamid: "a1", text: "", at: 1000, kind: "audio", mediaId: "m-9" });
  });

  it("actualiza el estado de entrega de los mensajes salientes", async () => {
    const { repo, messages } = memoryRepo();
    messages.set("out1", { conversationId: "c", direction: "out", type: "text", body: "hola", status: "sent" });
    await handleWebhookEvents(
      [{ kind: "status", wamid: "out1", status: "read", recipient: "549", timestamp: 1 }],
      deps(repo, []),
    );
    assert.equal(messages.get("out1")?.status, "read");
  });

  it("un evento que falla no frena a los demás", async () => {
    const { repo, messages } = memoryRepo();
    const failing: InboundRepo = {
      ...repo,
      async saveInbound(conversationId, msg) {
        if (msg.wamid === "malo") throw new Error("base caída");
        return repo.saveInbound(conversationId, msg);
      },
    };
    const buffered: { phone: string; message: BufferedMessage }[] = [];
    await handleWebhookEvents([text("malo", "x"), text("w2", "sigo")], deps(failing, buffered));
    assert.ok(messages.has("w2"));
    // El que no se pudo guardar (tras reintentar) se apila igual: el cliente no queda sin respuesta.
    assert.deepEqual(buffered.map((b) => b.message.wamid).sort(), ["malo", "w2"]);
  });
});
