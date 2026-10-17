import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redeemRecommendation } from "../src/lib/loyalty/recommendation.ts";
import { REWARDS } from "../src/lib/orders.ts";

describe("recomendación de canje", () => {
  it("si alcanza, recomienda la recompensa de más puntos que puede pagar", () => {
    const r = redeemRecommendation(180, REWARDS, 0.5);
    assert.equal(r?.kind, "ready");
    assert.equal(r?.reward.id, "bebida");
    assert.match(r!.message, /Bebida gratis/);
  });

  it("con puntos para todo, recomienda la más valiosa", () => {
    assert.equal(redeemRecommendation(500, REWARDS, 0.5)?.reward.id, "postre");
  });

  it("si le falta poco, dice cuánto le falta y con qué compra lo consigue", () => {
    const r = redeemRecommendation(90, REWARDS, 0.5);
    assert.equal(r?.kind, "close");
    assert.equal(r?.reward.id, "descuento");
    assert.equal(r?.missing, 10);
    // 10 pts a 0.5 por cada $100 → $2.000 de compra.
    assert.equal(r?.spendNeeded, 2000);
    assert.match(r!.message, /10 puntos/);
  });

  it("si le falta mucho no insiste", () => {
    assert.equal(redeemRecommendation(10, REWARDS, 0.5), null);
  });

  it("sin regla de puntos no calcula importes imposibles", () => {
    const r = redeemRecommendation(90, REWARDS, 0);
    assert.equal(r?.kind, "close");
    assert.equal(r?.spendNeeded, null);
  });

  it("sin recompensas no recomienda nada", () => {
    assert.equal(redeemRecommendation(1000, [], 0.5), null);
  });
});
