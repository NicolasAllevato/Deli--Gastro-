import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { applyReward, rewardNote } = await import("../src/lib/rewards.ts");
const { REWARDS } = await import("../src/lib/orders.ts");

const reward = (id: string) => REWARDS.find((r) => r.id === id)!;

describe("applyReward · porcentaje", () => {
  it("descuenta el 10 % del subtotal, sin tocar el envío", () => {
    const lines = [{ qty: 2, price: 8500, categoria: "Hamburguesas" }];
    assert.deepEqual(applyReward(reward("descuento"), lines, 17000), { ok: true, discount: 1700 });
  });

  it("redondea al peso y nunca supera el subtotal", () => {
    assert.deepEqual(applyReward(reward("descuento"), [], 1005), { ok: true, discount: 101 });
    assert.deepEqual(applyReward(reward("descuento"), [], 0), { ok: true, discount: 0 });
  });
});

describe("applyReward · producto gratis", () => {
  it("el postre gratis descuenta una unidad del más caro del pedido", () => {
    const lines = [
      { qty: 1, price: 5600, categoria: "Postres" },
      { qty: 1, price: 5200, categoria: "Postres" },
      { qty: 1, price: 8500, categoria: "Hamburguesas" },
    ];
    assert.deepEqual(applyReward(reward("postre"), lines, 19300), { ok: true, discount: 5600 });
  });

  it("descuenta una sola unidad aunque haya varias del mismo postre", () => {
    const lines = [{ qty: 3, price: 5600, categoria: "Postres" }];
    assert.deepEqual(applyReward(reward("postre"), lines, 16800), { ok: true, discount: 5600 });
  });

  it("la bebida gratis respeta el tope de $2.000", () => {
    const lines = [{ qty: 1, price: 2600, categoria: "Bebidas" }];
    assert.deepEqual(applyReward(reward("bebida"), lines, 2600), { ok: true, discount: 2000 });
  });

  it("la bebida más barata que el tope sale completa", () => {
    const lines = [{ qty: 1, price: 1500, categoria: "Bebidas" }];
    assert.deepEqual(applyReward(reward("bebida"), lines, 1500), { ok: true, discount: 1500 });
  });

  it("ignora mayúsculas y acentos al comparar la categoría", () => {
    const lines = [{ qty: 1, price: 1000, categoria: "  BEBIDAS " }];
    assert.equal(applyReward(reward("bebida"), lines, 1000).ok, true);
  });

  it("explica qué falta cuando el pedido no tiene un producto de la categoría", () => {
    const lines = [{ qty: 1, price: 8500, categoria: "Hamburguesas" }];
    const result = applyReward(reward("postre"), lines, 8500);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /postres/);
  });

  it("un producto sin categoría no cuenta", () => {
    assert.equal(applyReward(reward("bebida"), [{ qty: 1, price: 900, categoria: null }], 900).ok, false);
  });
});

describe("rewardNote", () => {
  it("deja en la aclaración qué canje se aplicó y por cuánto", () => {
    const note = rewardNote(reward("bebida"), 2000);
    assert.match(note, /Bebida gratis/);
    assert.match(note, /2\.000/);
  });
});
