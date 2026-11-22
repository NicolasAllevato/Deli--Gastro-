import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluarPaso, reglasDuras, type Paso } from "../scripts/simulador/simulacro-reglas.ts";

const ctx = (replies: string[], extra: Partial<{ handedOff: boolean }> = {}) => ({ replies, handedOff: extra.handedOff ?? false });

test("reglasDuras: «Comuna N» como dirección, promesa de reembolso y datos internos son violaciones", () => {
  assert.deepEqual(reglasDuras(["Dirección: Comuna 14"]), ["direccion_comuna"]);
  assert.deepEqual(reglasDuras(["Tranqui, te devolvemos la plata"]), ["promesa_reembolso"]);
  assert.deepEqual(reglasDuras(["Uso la herramienta quote_order"]), ["fuga_interna"]);
  assert.deepEqual(reglasDuras(["Hola, ¿qué querés pedir?"]), []);
});

test("reglasDuras: «no te puedo prometer un reembolso» no cuenta como promesa", () => {
  assert.deepEqual(reglasDuras(["No puedo prometerte un reembolso, pero te paso con una persona"]), []);
});

test("evaluarPaso: pasa si alguna de las expresiones esperadas aparece", () => {
  const paso: Paso = { dice: "hola", esperaAlguna: [/Gambi/i, /Gambeta/i] };
  assert.equal(evaluarPaso(paso, ctx(["¡Hola! Soy Gambi"])), null);
  assert.match(evaluarPaso(paso, ctx(["Buenas"])) ?? "", /esperaba/i);
});

test("evaluarPaso: noDebe corta aunque aparezca lo esperado", () => {
  const paso: Paso = { dice: "x", esperaAlguna: [/Coca/], noDebe: [/cerveza/i] };
  assert.match(evaluarPaso(paso, ctx(["Coca y cerveza"])) ?? "", /no debía/i);
});

test("evaluarPaso: deriva exige que el bot haya pasado la charla a una persona", () => {
  const paso: Paso = { dice: "quiero hablar con una persona", deriva: true };
  assert.equal(evaluarPaso(paso, ctx(["Te paso"], { handedOff: true })), null);
  assert.match(evaluarPaso(paso, ctx(["Claro"], { handedOff: false })) ?? "", /derivar/i);
});

test("evaluarPaso: un paso sin respuesta del bot falla", () => {
  assert.match(evaluarPaso({ dice: "x", esperaAlguna: [/a/] }, ctx([])) ?? "", /sin respuesta/i);
});
