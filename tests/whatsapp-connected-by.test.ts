import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildConnectedBy,
  CONNECTED_BY_KEY,
  facebookProfileSchema,
  parseConnectedBy,
  serializeConnectedBy,
  summarizeConnectedBy,
} from "../src/lib/whatsapp/connected-by.ts";
import { signupBodySchema } from "../src/lib/whatsapp/embedded-signup.ts";

const NOW = new Date("2026-11-08T12:00:00.000Z");
const ADMIN = { id: "9f1c-admin", email: "dueno@ejemplo.com" };

describe("facebookProfileSchema", () => {
  it("acepta id, nombre y email", () => {
    const parsed = facebookProfileSchema.safeParse({ id: "1234567890", name: "  Ana Pérez ", email: "ana@ejemplo.com" });
    assert.equal(parsed.success, true);
    if (parsed.success) assert.equal(parsed.data.name, "Ana Pérez");
  });

  it("el email es opcional (Facebook no siempre lo entrega)", () => {
    assert.equal(facebookProfileSchema.safeParse({ id: "1234567890", name: "Ana" }).success, true);
  });

  it("rechaza ids que no son numéricos, nombres vacíos o emails inválidos", () => {
    assert.equal(facebookProfileSchema.safeParse({ id: "abc", name: "Ana" }).success, false);
    assert.equal(facebookProfileSchema.safeParse({ id: "1234567890", name: "   " }).success, false);
    assert.equal(facebookProfileSchema.safeParse({ id: "1234567890", name: "Ana", email: "no-es-mail" }).success, false);
  });

  it("rechaza campos de más (no se guarda cualquier cosa que mande el navegador)", () => {
    assert.equal(facebookProfileSchema.safeParse({ id: "1234567890", name: "Ana", token: "x" }).success, false);
  });
});

describe("parseConnectedBy", () => {
  it("devuelve el perfil válido y undefined si falta o es inválido (la capa de Facebook es opcional)", () => {
    assert.deepEqual(parseConnectedBy({ id: "1234567890", name: "Ana" }), { id: "1234567890", name: "Ana" });
    assert.equal(parseConnectedBy(undefined), undefined);
    assert.equal(parseConnectedBy({ id: "x", name: "Ana" }), undefined);
    assert.equal(parseConnectedBy("texto"), undefined);
  });

  it("si solo el email es inválido, conserva el nombre en vez de perder todo el perfil", () => {
    assert.deepEqual(parseConnectedBy({ id: "1234567890", name: "Ana", email: "no-es-mail" }), { id: "1234567890", name: "Ana" });
  });
});

describe("buildConnectedBy / serialize / summarize", () => {
  it("siempre registra quién del panel conectó y cuándo", () => {
    const by = buildConnectedBy({ admin: ADMIN, now: NOW });
    assert.deepEqual(by, { adminId: "9f1c-admin", adminEmail: "dueno@ejemplo.com", connectedAt: "2026-11-08T12:00:00.000Z" });
  });

  it("suma los datos de Facebook cuando llegan", () => {
    const facebook = { id: "1234567890", name: "Ana", email: "ana@ejemplo.com" };
    assert.deepEqual(buildConnectedBy({ admin: ADMIN, now: NOW, facebook }).facebook, facebook);
  });

  it("sin email del admin no arrastra uno anterior: simplemente no hay adminEmail", () => {
    const by = buildConnectedBy({ admin: { id: "9f1c-admin", email: undefined }, now: NOW });
    assert.equal("adminEmail" in by, false);
  });

  it("ida y vuelta: lo guardado se resume completo, de una sola fila", () => {
    const facebook = { id: "1234567890", name: "Ana", email: "ana@ejemplo.com" };
    const value = serializeConnectedBy(buildConnectedBy({ admin: ADMIN, now: NOW, facebook }));
    assert.equal(typeof value, "string");
    assert.deepEqual(summarizeConnectedBy(value), {
      adminEmail: "dueno@ejemplo.com",
      facebookName: "Ana",
      facebookEmail: "ana@ejemplo.com",
      connectedAt: "2026-11-08T12:00:00.000Z",
    });
  });

  it("una conexión sin Facebook no deja datos de otra persona", () => {
    const value = serializeConnectedBy(buildConnectedBy({ admin: ADMIN, now: NOW }));
    assert.equal(summarizeConnectedBy(value)?.facebookName, null);
  });

  it("valores ausentes, vacíos o corruptos no rompen el panel: se ven como 'sin registro'", () => {
    assert.equal(summarizeConnectedBy(null), null);
    assert.equal(summarizeConnectedBy(undefined), null);
    assert.equal(summarizeConnectedBy("{no es json"), null);
    assert.equal(summarizeConnectedBy(JSON.stringify({ cualquier: "cosa" })), null);
  });

  it("la clave de guardado es una sola y no está en la vista del bot", () => {
    assert.equal(CONNECTED_BY_KEY, "whatsapp_connected_by");
  });
});

describe("signupBodySchema con perfil de Facebook", () => {
  const base = { mode: "coexistence", code: "abc", wabaId: "1234567890" };

  it("acepta el campo facebook opcional en ambos modos", () => {
    const facebook = { id: "1234567890", name: "Ana" };
    assert.equal(signupBodySchema.safeParse({ ...base, facebook }).success, true);
    assert.equal(
      signupBodySchema.safeParse({ mode: "standard", code: "abc", wabaId: "1234567890", phoneNumberId: "1234567890", pin: "123456", facebook }).success,
      true,
    );
  });

  it("sigue aceptando el cuerpo sin facebook", () => {
    assert.equal(signupBodySchema.safeParse(base).success, true);
  });

  it("un facebook malformado NO tumba el alta: el servidor lo descarta después (no se pierde la conexión)", () => {
    assert.equal(signupBodySchema.safeParse({ ...base, facebook: { id: "x", name: "Ana" } }).success, true);
  });
});
