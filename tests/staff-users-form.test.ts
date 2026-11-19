/** Cuerpos que arma el formulario de /admin/usuarios: el alta y solo lo que cambió en la edición. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./helpers/alias.ts";

const { DEFAULT_PERMISSIONS } = await import("../src/lib/auth/permissions.ts");
const { buildCreateBody, buildPatchBody, selectableRoles } = await import("../src/app/admin/usuarios/payload.ts");

const original = {
  id: "u1", name: "Gerardo", email: "g@local.test", staff_role: "gerente" as const,
  permissions: DEFAULT_PERMISSIONS.gerente, banned: false, createdAt: "2026-11-19T00:00:00.000Z",
  isSuperOwner: false, canEdit: true,
};
const form = { name: "Gerardo", email: "g@local.test", password: "", currentPassword: "", role: "gerente" as const, permissions: DEFAULT_PERMISSIONS.gerente, banned: false };

describe("buildCreateBody", () => {
  it("manda nombre, email, contraseña, rol y permisos", () => {
    const body = buildCreateBody({ ...form, name: "  Ana ", email: " ana@local.test ", password: "clave-segura-123", role: "cajero", permissions: DEFAULT_PERMISSIONS.cajero });
    assert.deepEqual(body, { name: "Ana", email: "ana@local.test", password: "clave-segura-123", staff_role: "cajero", permissions: { ...DEFAULT_PERMISSIONS.cajero } });
  });

  it("el dueño no manda permisos", () => {
    assert.equal("permissions" in buildCreateBody({ ...form, role: "admin", permissions: DEFAULT_PERMISSIONS.admin }), false);
  });
});

describe("selectableRoles", () => {
  it("la opción Dueño solo la ve el dueño principal", () => {
    assert.deepEqual(selectableRoles(true, null), ["admin", "gerente", "cajero"]);
    assert.deepEqual(selectableRoles(false, null), ["gerente", "cajero"]);
    assert.deepEqual(selectableRoles(false, "gerente"), ["gerente", "cajero"]);
  });

  it("si el usuario ya es dueño se muestra igual (el selector queda deshabilitado)", () => {
    assert.deepEqual(selectableRoles(false, "admin"), ["admin", "gerente", "cajero"]);
  });
});

describe("buildPatchBody", () => {
  it("al cambiar la contraseña manda también la actual (solo hace falta sobre uno mismo)", () => {
    assert.deepEqual(buildPatchBody(original, { ...form, password: "nueva-clave-larga", currentPassword: "la-de-hoy-123" }), {
      password: "nueva-clave-larga", current_password: "la-de-hoy-123",
    });
    assert.deepEqual(buildPatchBody(original, { ...form, currentPassword: "la-de-hoy-123" }), {}, "la actual sola no es un cambio");
  });

  it("sin cambios: vacío", () => {
    assert.deepEqual(buildPatchBody(original, form), {});
  });

  it("solo manda lo que cambió", () => {
    assert.deepEqual(buildPatchBody(original, { ...form, name: " Gerardo P. " }), { name: "Gerardo P." });
    assert.deepEqual(buildPatchBody(original, { ...form, banned: true }), { banned: true });
    assert.deepEqual(buildPatchBody(original, { ...form, password: "nueva-clave-larga" }), { password: "nueva-clave-larga" });
  });

  it("al ajustar un permiso manda el juego completo", () => {
    const body = buildPatchBody(original, { ...form, permissions: { ...DEFAULT_PERMISSIONS.gerente, configuracion: "edit" } });
    assert.deepEqual(Object.keys(body), ["permissions"]);
    assert.equal((body.permissions as Record<string, string>).configuracion, "edit");
    assert.equal(Object.keys(body.permissions as object).length, 6);
  });

  it("al cambiar de rol manda rol y permisos precargados; a dueño, solo el rol", () => {
    assert.deepEqual(buildPatchBody(original, { ...form, role: "cajero", permissions: DEFAULT_PERMISSIONS.cajero }), {
      staff_role: "cajero", permissions: { ...DEFAULT_PERMISSIONS.cajero },
    });
    assert.deepEqual(buildPatchBody(original, { ...form, role: "admin", permissions: DEFAULT_PERMISSIONS.admin }), { staff_role: "admin" });
  });
});
