import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createDemoDb } from "./helpers/demo-db.ts";

const KEY = randomBytes(32).toString("base64");
process.env.COURIER_PIN_SECRET = "test-secret";
process.env.COURIER_PIN_KEY = KEY;

const { encryptPin, decryptPin, pinKeyB64 } = await import("../src/lib/courier-pin-crypto.ts");
const { createCourier, changeCourierPin, renameCourier, revealCourierPin, listCouriers, findCourierByPin, hashPin } =
  await import("../src/lib/courier-pins.ts");
import type { CourierAuth } from "../src/lib/courier-pins.ts";

const USER = "00000000-0000-4000-8000-000000000001";

function fakeAuth(): CourierAuth {
  let n = 0;
  return {
    async createUser() { n += 1; return { id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` }; },
    async setBlocked() { return null; },
  };
}

describe("cifrado del PIN", () => {
  it("cifra y descifra, con IV distinto cada vez", async () => {
    const a = await encryptPin("0420", USER, KEY);
    const b = await encryptPin("0420", USER, KEY);
    assert.notEqual(a, b);
    assert.ok(!a.includes("0420"));
    assert.equal(await decryptPin(a, USER, KEY), "0420");
  });

  it("no descifra con otra clave, otro repartidor o datos alterados", async () => {
    const blob = await encryptPin("1234", USER, KEY);
    assert.equal(await decryptPin(blob, USER, randomBytes(32).toString("base64")), null);
    assert.equal(await decryptPin(blob, "00000000-0000-4000-8000-000000000002", KEY), null);
    assert.equal(await decryptPin(blob.slice(0, -4) + "AAAA", USER, KEY), null);
    assert.equal(await decryptPin("basura", USER, KEY), null);
  });

  it("rechaza claves que no son de 32 bytes y sin clave no hay cifrado (salvo demo)", async () => {
    await assert.rejects(encryptPin("1234", USER, Buffer.from("corta").toString("base64")), /32 bytes/);
    assert.equal(pinKeyB64({} as unknown as NodeJS.ProcessEnv), null);
    assert.ok(pinKeyB64({ NEXT_PUBLIC_DEMO_MODE: "true" } as unknown as NodeJS.ProcessEnv));
  });
});

describe("ver, resetear y editar repartidores", () => {
  it("al crear guarda la copia cifrada y el admin la puede ver; el listado no la expone", async () => {
    const { db, store } = createDemoDb();
    const res = await createCourier(db, fakeAuth(), { name: "Ana", pin: "4821" });
    assert.ok(res.ok);
    const row = store.couriers.find((r) => r.name === "Ana") as Record<string, unknown>;
    assert.equal(typeof row.pin_encrypted, "string");
    assert.ok(!String(row.pin_encrypted).includes("4821"));
    assert.deepEqual(await revealCourierPin(db, res.courier.userId), { ok: true, pin: "4821" });
    assert.ok(!JSON.stringify(await listCouriers(db)).includes("pin"));
  });

  it("resetear genera un PIN nuevo, actualiza hash y cifrado, y mantiene la unicidad", async () => {
    const { db } = createDemoDb();
    const auth = fakeAuth();
    const ana = await createCourier(db, auth, { name: "Ana", pin: "1111" });
    const beto = await createCourier(db, auth, { name: "Beto", pin: "2222" });
    assert.ok(ana.ok && beto.ok);

    const reset = await changeCourierPin(db, ana.courier.userId);
    assert.ok(reset.ok);
    assert.match(reset.pin, /^\d{4}$/);
    assert.notEqual(reset.pin, "2222");
    assert.deepEqual(await revealCourierPin(db, ana.courier.userId), { ok: true, pin: reset.pin });
    assert.equal((await findCourierByPin(db, reset.pin))?.name, "Ana");

    const dup = await changeCourierPin(db, ana.courier.userId, "2222");
    assert.equal(dup.ok ? null : dup.status, 409);
  });

  it("repartidor sin copia cifrada (anterior a la 030) devuelve pin null", async () => {
    const { db, store } = createDemoDb();
    store.couriers.push({
      user_id: USER, name: "Viejo", pin_hash: hashPin("9999"), active: true,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    } as (typeof store.couriers)[number]);
    assert.deepEqual(await revealCourierPin(db, USER), { ok: true, pin: null });
    const missing = await revealCourierPin(db, "00000000-0000-4000-8000-00000000ffff");
    assert.equal(missing.ok ? null : missing.status, 404);
  });

  it("edita el nombre", async () => {
    const { db } = createDemoDb();
    const res = await createCourier(db, fakeAuth(), { name: "Ana", pin: "3333" });
    assert.ok(res.ok);
    const renamed = await renameCourier(db, res.courier.userId, "Ana María");
    assert.ok(renamed.ok && renamed.courier.name === "Ana María");
  });
});

describe("permiso de admin", () => {
  const route = (p: string) => readFileSync(new URL(`../src/app/api/admin/couriers/${p}`, import.meta.url), "utf8");

  it("la ruta que muestra el PIN exige admin antes de descifrar y no se cachea", () => {
    const src = route("[id]/pin/route.ts");
    const guard = src.indexOf("await guardAdmin(req");
    assert.ok(guard > 0, "falta guardAdmin");
    assert.ok(guard < src.indexOf("revealCourierPin(createAdminClient()"), "guardAdmin tiene que ir primero");
    assert.match(src, /if \(denied\) return denied;/);
    assert.match(src, /no-store/);
    assert.doesNotMatch(src, /export async function (POST|PATCH|PUT|DELETE)/);
  });

  it("editar y resetear también pasan por guardAdmin", () => {
    const src = route("[id]/route.ts");
    assert.ok(src.indexOf("await guardAdmin(req") < src.indexOf("renameCourier(db"));
  });
});
