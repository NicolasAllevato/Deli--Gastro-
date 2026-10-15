import { test } from "node:test";
import assert from "node:assert/strict";
import { validateImage, isAuthorized, isValidObjectKey, MAX_SIZE_BYTES } from "../src/validate.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);

test("acepta png, jpg y webp con firma correcta", () => {
  assert.deepEqual(validateImage("image/png", PNG), { ok: true, ext: "png" });
  assert.deepEqual(validateImage("image/jpeg", JPG), { ok: true, ext: "jpg" });
  assert.deepEqual(validateImage("image/webp", WEBP), { ok: true, ext: "webp" });
});

test("rechaza tipos no permitidos", () => {
  const r = validateImage("image/svg+xml", PNG);
  assert.equal(r.ok, false);
});

test("rechaza si los bytes no coinciden con el content-type", () => {
  assert.equal(validateImage("image/png", JPG).ok, false);
  assert.equal(validateImage("image/jpeg", new TextEncoder().encode("<html>hola</html>")).ok, false);
});

test("rechaza vacío y > 5MB", () => {
  assert.equal(validateImage("image/png", new Uint8Array(0)).ok, false);
  const big = new Uint8Array(MAX_SIZE_BYTES + 1);
  big.set(PNG);
  assert.equal(validateImage("image/png", big).ok, false);
});

test("auth bearer: exige token exacto", () => {
  assert.equal(isAuthorized("Bearer abc123", "abc123"), true);
  assert.equal(isAuthorized("Bearer abc124", "abc123"), false);
  assert.equal(isAuthorized(null, "abc123"), false);
  assert.equal(isAuthorized("Bearer ", ""), false);
  assert.equal(isAuthorized("abc123", "abc123"), false);
});

test("clave de objeto: solo productos/<uuid>.<ext>", () => {
  assert.equal(isValidObjectKey("productos/0b8f3f0e-1c2d-4e5f-8a9b-0c1d2e3f4a5b.png"), true);
  assert.equal(isValidObjectKey("productos/../secreto.png"), false);
  assert.equal(isValidObjectKey("otra/0b8f3f0e-1c2d-4e5f-8a9b-0c1d2e3f4a5b.png"), false);
  assert.equal(isValidObjectKey("productos/0b8f3f0e-1c2d-4e5f-8a9b-0c1d2e3f4a5b.exe"), false);
});
