/** Guardrails de privacidad de WhatsApp: salida del bot, logs y apilador de mensajes. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  inspectPrivacy, maskPhone, mergeInspections, passesLuhn, redactDetail, redactPii, redactingLog, safeError,
} from "../src/lib/whatsapp/privacy.ts";
import { withPrivacy } from "../workers/whatsapp-bot/src/privacy.ts";
import { addMessage, emptyBatch, withoutSent, type BufferedMessage } from "../workers/whatsapp-bot/src/batching.ts";

describe("inspectPrivacy: salida del bot", () => {
  const blocked = (text: string) => inspectPrivacy(text).verdict === "block";

  it("deja pasar respuestas normales del local", () => {
    for (const ok of [
      "¡Hola! La muzza grande sale $8.500 y llega en 30 min.",
      "Tu pedido #A1B2C3D4 está en preparación.",
      "Atendemos de 11:00 a 23:00. Envío a Palermo: $1.200.",
      "Pagá acá: https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=123456-1b4e28ba-2fa1-11d2-883f-0016d3cca427",
    ]) assert.equal(blocked(ok), false, ok);
  });

  it("bloquea emails, salvo los permitidos", () => {
    assert.equal(blocked("Escribile a juan.perez@gmail.com"), true);
    assert.equal(inspectPrivacy("Escribinos a hola@local.com", { allowedEmails: ["hola@local.com"] }).verdict, "ok");
  });

  it("bloquea tarjetas válidas (Luhn) pero no cualquier número largo", () => {
    assert.equal(blocked("La tarjeta 4111 1111 1111 1111 quedó"), true);
    assert.equal(blocked("Código 1234 5678 9012 3456"), false);
    assert.equal(passesLuhn("4111111111111111"), true);
  });

  it("bloquea CBU/CVU y DNI", () => {
    assert.equal(blocked("Transferí al 0170099220000067797370"), true);
    assert.equal(blocked("El DNI del cliente es 30.123.456"), true);
  });

  it("bloquea ids internos, SQL, trazas y credenciales", () => {
    assert.equal(blocked("El id es 1b4e28ba-2fa1-11d2-883f-0016d3cca427"), true);
    assert.equal(blocked("SELECT phone FROM clients"), true);
    assert.equal(blocked("TypeError: x is undefined at run (turn.ts:10:5)"), true);
    assert.equal(blocked("api_key: abcdefghijklmnop1234"), true);
  });

  it("se combina con la inspección existente: alcanza con que una bloquee", () => {
    assert.equal(withPrivacy("hola", { verdict: "ok", reasons: [] }).verdict, "ok");
    assert.equal(withPrivacy("x@y.com", { verdict: "ok", reasons: [] }).verdict, "block");
    assert.deepEqual(mergeInspections({ verdict: "block", reasons: ["a"] }, { verdict: "ok", reasons: [] }), { verdict: "block", reasons: ["a"] });
  });
});

describe("logs sin datos personales", () => {
  it("enmascara teléfonos", () => {
    assert.equal(maskPhone("+54 9 11 5555-0101"), "***0101");
    assert.equal(maskPhone(null), "***");
    assert.equal(redactPii("falló el envío a 5491155550101"), "falló el envío a ***0101");
  });

  it("saca tokens y emails, deja ids cortos", () => {
    const out = redactPii("token EAAB1234567890abcdefghijklmnop de a@b.com pedido #A1B2");
    assert.doesNotMatch(out, /EAAB|a@b\.com/);
    assert.match(out, /#A1B2/);
  });

  it("safeError usa solo el mensaje y lo redacta", () => {
    assert.equal(safeError(new Error("Recipient 5491155550101 not allowed")), "Recipient ***0101 not allowed");
    assert.equal(safeError({ secreto: 1 }), "error desconocido");
  });

  it("redacta el detalle en profundidad y el logger no imprime crudo", () => {
    assert.deepEqual(redactDetail({ to: "5491155550101", list: ["x@y.com"] }), { to: "***0101", list: ["[email]"] });
    const lines: unknown[] = [];
    redactingLog((m, d) => lines.push([m, d]))("envío a 5491155550101", { body: "hola", mail: "x@y.com" });
    assert.doesNotMatch(JSON.stringify(lines), /5491155550101|x@y\.com/);
  });
});

describe("apilador: no se pierden mensajes que llegan durante el envío", () => {
  const msg = (wamid: string, at: number): BufferedMessage => ({ wamid, text: wamid, at, kind: "text" });

  it("withoutSent deja solo lo que no se encoló", () => {
    const batch = [msg("a", 1), msg("b", 2), msg("c", 3)].reduce(addMessage, emptyBatch());
    const rest = withoutSent(batch, ["a", "b"]);
    assert.deepEqual(rest.messages.map((m) => m.wamid), ["c"]);
    assert.equal(rest.firstAt, 3);
    assert.equal(withoutSent(batch, ["a", "b", "c"]).messages.length, 0);
  });
});
