import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./helpers/alias.ts";
import { isComplaintReply, looksLikeNewOrder } from "../workers/whatsapp-bot/src/bot/complaints.ts";
import { processTurn, type TurnDeps } from "../workers/whatsapp-bot/src/bot/turn.ts";
import type { BotRepo, ComplaintInput, ComplaintTicket } from "../workers/whatsapp-bot/src/repo/types.ts";

const OPEN_CFG = { agente_activo: true, horario_apertura: "00:00", horario_cierre: "23:59", negocio_nombre: "La Gambeta", agente_nombre: "Gambe" };
const REGISTRO = "Perdón por el mal momento 🙏\nSi podés, mandame una foto del pedido así lo vemos.\nYa lo registramos (reclamo #1). El local lo revisa y te escribimos por acá.";
const ACUSE = "Gracias, lo sumé a tu reclamo #1. El local lo revisa y te escribimos por acá.";
const ACUSE_FOTO = "¡Gracias por la foto! La sumé al reclamo #1. El local lo revisa y te escribimos por acá.";

describe("reclamo: qué mensajes del bot permiten seguir el reclamo", () => {
  it("el aviso de registro sí; los acuses «lo sumé» no (si no, el cliente queda atrapado en el reclamo)", () => {
    assert.equal(isComplaintReply(REGISTRO), true);
    assert.equal(isComplaintReply(ACUSE), false);
    assert.equal(isComplaintReply(ACUSE_FOTO), false);
    assert.equal(isComplaintReply("Hola, ¿qué querés pedir?"), false);
    assert.equal(isComplaintReply(null), false);
  });

  it("looksLikeNewOrder: pedido claro sí, respuesta al reclamo no", () => {
    assert.equal(looksLikeNewOrder("quiero 1 muzzarella grande para delivery a Av. Santa Fe 1234"), true);
    assert.equal(looksLikeNewOrder("dame una napo y dos empanadas"), true);
    assert.equal(looksLikeNewOrder("quiero hacer un pedido"), true);
    assert.equal(looksLikeNewOrder("sí, ese pedido"), false);
    assert.equal(looksLikeNewOrder("llegó frío y faltó una bebida"), false);
    assert.equal(looksLikeNewOrder("el pedido de ayer llegó a las 22 hs"), false);
  });
});

function world(lastOut: string) {
  const sent: string[] = [];
  const complaints: ComplaintInput[] = [];
  const open: ComplaintTicket = { id: "r1", numero: 1, created: false, categoria: "llego_frio", orderId: null, fotos: 0, createdAt: new Date() };
  const repo: BotRepo = {
    getConversation: async (phone) => ({ id: "c1", phone, clientId: "cl1", displayName: "Tata", humanTakeover: false }),
    history: async () => [{ direction: "in", body: "x" }, { direction: "out", body: lastOut }],
    inboundCounts: async () => ({ lastMinute: 1, lastDay: 1 }),
    config: async () => OPEN_CFG,
    menu: async () => [],
    zones: async () => [],
    latestOrder: async () => null,
    setTakeover: async () => {},
    setMarketingOptIn: async () => 1,
    saveOutbound: async (_c, _w, body) => { sent.push(body); },
    saveTranscript: async () => {},
    lastOutboundAt: async () => new Date(),
    createComplaint: async (c) => { complaints.push(c); return open; },
    openComplaint: async () => open,
  };
  const run: TurnDeps["run"] = async (_m, input) => {
    if ("response_format" in input) return { response: JSON.stringify({ intent: "pedido_nuevo", confidence: 0.95 }) };
    return { response: "¡Dale! ¿A qué dirección te lo mandamos?" };
  };
  let n = 0;
  const deps: TurnDeps = { repo, run, transcribe: async () => null, send: async () => `o-${++n}`, appUrl: "https://opsyndely.la-gambeta.com", log: () => {} };
  const send = (text: string) => processTurn({ phone: "5491170000001", text, wamids: ["w1"], audios: [], receivedAt: 0 }, deps);
  return { send, sent, complaints };
}

describe("reclamo abierto: el cliente puede volver a pedir", () => {
  it("tras el acuse «lo sumé a tu reclamo», un pedido nuevo NO se suma al reclamo", async () => {
    const w = world(ACUSE);
    const outcome = await w.send("quiero 1 muzzarella grande para delivery a Av. Santa Fe 1234, Palermo");
    assert.notEqual(outcome, "ticket");
    assert.equal(w.complaints.length, 0);
    assert.doesNotMatch(w.sent.join("\n"), /lo sumé a tu reclamo/);
  });

  it("justo después del aviso de registro, un pedido claro tampoco se suma al reclamo", async () => {
    const w = world(REGISTRO);
    const outcome = await w.send("quiero 2 empanadas de carne para delivery a Juramento 1500");
    assert.notEqual(outcome, "ticket");
    assert.equal(w.complaints.length, 0);
  });

  it("justo después del aviso de registro, la respuesta del cliente sí se suma al mismo reclamo", async () => {
    const w = world(REGISTRO);
    assert.equal(await w.send("sí, llegó frío y faltó una bebida"), "ticket");
    assert.equal(w.complaints.length, 1);
    assert.match(w.sent.join("\n"), /reclamo #1/);
  });
});
