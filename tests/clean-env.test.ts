import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanEnv } from "../src/lib/clean-env.ts";

// Armado con su código: un BOM pegado en el fuente es invisible y se pierde con los editores.
const BOM = String.fromCharCode(0xfeff);

describe("cleanEnv", () => {
  it("devuelve cadena vacía si no hay valor", () => {
    assert.equal(cleanEnv(undefined), "");
  });

  it("deja intacto un valor limpio", () => {
    assert.equal(cleanEnv("eyJhbGciOi.abc-def_ghi"), "eyJhbGciOi.abc-def_ghi");
  });

  it("quita el BOM del inicio", () => {
    assert.equal(cleanEnv(`${BOM}clave`), "clave");
  });

  it("quita BOM junto con espacios y saltos de línea de los bordes", () => {
    assert.equal(cleanEnv(`${BOM}  clave\r\n`), "clave");
  });

  it("no toca espacios internos", () => {
    assert.equal(cleanEnv(" a b "), "a b");
  });
});
