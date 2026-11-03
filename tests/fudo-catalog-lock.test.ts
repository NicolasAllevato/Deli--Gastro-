import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { stripFudoManaged, FUDO_MANAGED_FIELDS, FUDO_MANAGED_CATEGORY_FIELDS } = await import("../src/lib/fudo/catalog-lock.ts");

describe("stripFudoManaged", () => {
  const patch = { name: "Nuevo", price: 1, is_active: false, category_id: null, description: "rico", image_url: "https://x/y.jpg", points_per_100: 5 };

  it("en un producto vinculado a Fudo descarta nombre, precio, disponibilidad y categoría", () => {
    const out = stripFudoManaged(patch, 7);
    assert.deepEqual(out.patch, { description: "rico", image_url: "https://x/y.jpg", points_per_100: 5 });
    assert.deepEqual(out.ignored.sort(), [...FUDO_MANAGED_FIELDS].sort());
  });

  it("en un producto manual no toca nada", () => {
    const out = stripFudoManaged(patch, null);
    assert.deepEqual(out.patch, patch);
    assert.deepEqual(out.ignored, []);
  });

  it("solo informa como ignorados los campos que venían en el pedido", () => {
    const out = stripFudoManaged({ price: 3, description: "x" }, 7);
    assert.deepEqual(out.ignored, ["price"]);
    assert.deepEqual(out.patch, { description: "x" });
  });

  it("no muta el objeto de entrada", () => {
    const input = { name: "A", description: "b" };
    stripFudoManaged(input, 7);
    assert.deepEqual(input, { name: "A", description: "b" });
  });
});

describe("stripFudoManaged en categorías", () => {
  it("solo el nombre lo manda Fudo; descripción, visibilidad y puntos se editan acá", () => {
    const out = stripFudoManaged({ name: "X", description: "d", is_active: false, points_per_100: 2 }, 3, FUDO_MANAGED_CATEGORY_FIELDS);
    assert.deepEqual(out.patch, { description: "d", is_active: false, points_per_100: 2 });
    assert.deepEqual(out.ignored, ["name"]);
  });

  it("una categoría manual no se toca", () => {
    const out = stripFudoManaged({ name: "X" }, null, FUDO_MANAGED_CATEGORY_FIELDS);
    assert.deepEqual(out.patch, { name: "X" });
  });
});

