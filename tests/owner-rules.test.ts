/**
 * Reglas de quién puede tocar a quién entre los usuarios del personal (dueño principal, otros dueños, uno mismo).
 * Los emails son ficticios: el dueño principal real sale de SUPER_OWNER_EMAIL y no figura en el código ni en las pruebas.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SYSTEM_ACTOR, actorFromRow, canEditTarget, createViolation, editViolation, isSuperOwnerEmail, superOwnerEmailFrom,
  type RuleActor, type RuleTarget,
} from "../src/lib/auth/owner-rules.ts";

const SUPER_EMAIL = "principal@ejemplo.test";

const superActor: RuleActor = { id: "u-super", isOwner: true, isSuper: true };
const ownerActor: RuleActor = { id: "u-socio", isOwner: true, isSuper: false };
const managerActor: RuleActor = { id: "u-gerente", isOwner: false, isSuper: false };

const superTarget: RuleTarget = { id: "u-super", staffRole: "admin", isSuper: true };
const ownerTarget: RuleTarget = { id: "u-socio", staffRole: "admin", isSuper: false };
const managerTarget: RuleTarget = { id: "u-gerente", staffRole: "gerente", isSuper: false };
const cashierTarget: RuleTarget = { id: "u-cajero", staffRole: "cajero", isSuper: false };

describe("SUPER_OWNER_EMAIL", () => {
  it("se normaliza (espacios y mayúsculas) y sin valor no hay dueño principal", () => {
    assert.equal(superOwnerEmailFrom({ SUPER_OWNER_EMAIL: "  Principal@Ejemplo.TEST " }), SUPER_EMAIL);
    for (const env of [{}, { SUPER_OWNER_EMAIL: "" }, { SUPER_OWNER_EMAIL: "   " }, { SUPER_OWNER_EMAIL: undefined }]) {
      assert.equal(superOwnerEmailFrom(env), null);
    }
  });

  it("isSuperOwnerEmail compara sin distinguir mayúsculas; sin configurar, nadie lo es", () => {
    assert.equal(isSuperOwnerEmail("PRINCIPAL@ejemplo.test", SUPER_EMAIL), true);
    assert.equal(isSuperOwnerEmail(" principal@ejemplo.test ", SUPER_EMAIL), true);
    assert.equal(isSuperOwnerEmail("otro@ejemplo.test", SUPER_EMAIL), false);
    assert.equal(isSuperOwnerEmail("principal@ejemplo.test", null), false);
    assert.equal(isSuperOwnerEmail(null, SUPER_EMAIL), false);
    assert.equal(isSuperOwnerEmail(undefined, SUPER_EMAIL), false);
    assert.equal(isSuperOwnerEmail("xprincipal@ejemplo.test", SUPER_EMAIL), false, "no vale un email que solo contiene al configurado");
  });
});

describe("actorFromRow", () => {
  const row = (over: Partial<{ email: string; staffRole: unknown; banned: boolean }> = {}) =>
    ({ id: "u1", email: "principal@ejemplo.test", staffRole: "admin", banned: false, ...over });

  it("el dueño con el email configurado es el principal", () => {
    assert.deepEqual(actorFromRow(row(), SUPER_EMAIL), { id: "u1", isOwner: true, isSuper: true });
    assert.deepEqual(actorFromRow(row({ email: "otro@ejemplo.test" }), SUPER_EMAIL), { id: "u1", isOwner: true, isSuper: false });
  });

  it("sin SUPER_OWNER_EMAIL hay dueños pero ninguno es el principal", () => {
    assert.deepEqual(actorFromRow(row(), null), { id: "u1", isOwner: true, isSuper: false });
  });

  it("un admin anterior a la migración (sin staff_role) es dueño", () => {
    assert.equal(actorFromRow(row({ staffRole: null }), SUPER_EMAIL).isOwner, true);
  });

  it("un gerente o cajero, o un dueño bloqueado, no tienen facultades aunque el email coincida", () => {
    for (const over of [{ staffRole: "gerente" }, { staffRole: "cajero" }, { banned: true }]) {
      assert.deepEqual(actorFromRow(row(over), SUPER_EMAIL), { id: "u1", isOwner: false, isSuper: false }, JSON.stringify(over));
    }
  });
});

describe("editViolation: quién edita a quién", () => {
  it("un dueño común no edita a otro dueño (403), ni al principal", () => {
    const other: RuleTarget = { id: "u-otro", staffRole: "admin", isSuper: false };
    assert.equal(editViolation(ownerActor, other, { banned: false })?.status, 403);
    assert.equal(editViolation(ownerActor, other, {})?.status, 403, "ni el nombre ni la contraseña");
    assert.equal(editViolation(ownerActor, superTarget, {})?.status, 403);
  });

  it("el principal edita a otros dueños: nombre, rol, bloqueo", () => {
    assert.equal(editViolation(superActor, ownerTarget, {}), null);
    assert.equal(editViolation(superActor, ownerTarget, { staffRole: "gerente" }), null);
    assert.equal(editViolation(superActor, ownerTarget, { banned: true }), null);
  });

  it("cualquier dueño edita gerentes y cajeros, pero solo el principal promueve a dueño", () => {
    for (const actor of [superActor, ownerActor]) {
      assert.equal(editViolation(actor, managerTarget, { staffRole: "cajero" }), null);
      assert.equal(editViolation(actor, cashierTarget, { banned: true }), null);
      assert.equal(editViolation(actor, managerTarget, {}), null);
    }
    assert.equal(editViolation(superActor, managerTarget, { staffRole: "admin" }), null);
    const promote = editViolation(ownerActor, managerTarget, { staffRole: "admin" });
    assert.equal(promote?.status, 403);
    assert.match(promote?.error ?? "", /dueño principal/);
  });

  it("un gerente o cajero no gestiona usuarios", () => {
    assert.equal(editViolation(managerActor, cashierTarget, {})?.status, 403);
    assert.equal(editViolation(managerActor, managerTarget, {})?.status, 403);
  });

  it("el principal no se bloquea ni se degrada: ni él mismo, ni otro dueño, ni el sistema", () => {
    for (const actor of [superActor, ownerActor, SYSTEM_ACTOR, managerActor]) {
      for (const patch of [{ banned: true }, { staffRole: "gerente" as const }, { staffRole: "cajero" as const }]) {
        const v = editViolation(actor, superTarget, patch);
        assert.equal(v?.status, 403, `${JSON.stringify(actor)} ${JSON.stringify(patch)}`);
        assert.match(v?.error ?? "", /dueño principal/);
      }
    }
    // lo que no lo degrada ni lo bloquea sí se permite al propio principal
    assert.equal(editViolation(superActor, superTarget, {}), null);
    assert.equal(editViolation(superActor, superTarget, { staffRole: "admin", banned: false }), null);
  });

  it("sobre uno mismo (dueño común): nombre y contraseña sí; rol y bloqueo no (400)", () => {
    assert.equal(editViolation(ownerActor, ownerTarget, {}), null);
    assert.equal(editViolation(ownerActor, ownerTarget, { staffRole: "admin", banned: false }), null, "mandar lo mismo no es un cambio");
    assert.equal(editViolation(ownerActor, ownerTarget, { staffRole: "gerente" })?.status, 400);
    assert.equal(editViolation(ownerActor, ownerTarget, { staffRole: "cajero" })?.status, 400);
    assert.equal(editViolation(ownerActor, ownerTarget, { banned: true })?.status, 400);
  });

  it("el sistema puede editar a dueños comunes pero no al principal", () => {
    assert.equal(editViolation(SYSTEM_ACTOR, ownerTarget, { staffRole: "gerente" }), null);
    assert.equal(editViolation(SYSTEM_ACTOR, managerTarget, { staffRole: "admin" }), null);
  });
});

describe("createViolation", () => {
  it("solo el principal crea dueños; los demás dueños crean gerentes y cajeros", () => {
    assert.equal(createViolation(superActor, "admin"), null);
    assert.equal(createViolation(ownerActor, "admin")?.status, 403);
    assert.equal(createViolation(ownerActor, "gerente"), null);
    assert.equal(createViolation(ownerActor, "cajero"), null);
    assert.equal(createViolation(SYSTEM_ACTOR, "admin"), null);
  });

  it("quien no es dueño no crea nada", () => {
    for (const role of ["admin", "gerente", "cajero"] as const) assert.equal(createViolation(managerActor, role)?.status, 403);
  });
});

describe("canEditTarget (botón de editar)", () => {
  it("dueños comunes: solo ven editable a sí mismos, a gerentes y a cajeros", () => {
    assert.equal(canEditTarget(ownerActor, ownerTarget), true, "uno mismo");
    assert.equal(canEditTarget(ownerActor, superTarget), false);
    assert.equal(canEditTarget(ownerActor, { id: "u-otro", staffRole: "admin" }), false);
    assert.equal(canEditTarget(ownerActor, managerTarget), true);
    assert.equal(canEditTarget(ownerActor, cashierTarget), true);
  });

  it("el principal edita a todos", () => {
    for (const t of [superTarget, ownerTarget, managerTarget, cashierTarget]) assert.equal(canEditTarget(superActor, t), true, t.id);
  });

  it("quien no es dueño no edita a nadie", () => {
    for (const t of [superTarget, ownerTarget, managerTarget, cashierTarget]) assert.equal(canEditTarget(managerActor, t), false, t.id);
  });
});
