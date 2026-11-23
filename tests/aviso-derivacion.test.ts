import { test } from "node:test";
import assert from "node:assert/strict";
import {
  derivacionesPorAvisar,
  nombreSeguro,
  podarVistos,
  recortarTexto,
  textoNotificacion,
  leerVistos,
  guardarVistos,
  type DerivacionAviso,
} from "../src/lib/conversaciones/aviso-derivacion.ts";

const d = (id: string, extra: Partial<DerivacionAviso> = {}): DerivacionAviso => ({
  id,
  nombre: "Ana",
  desde: "2026-11-23T12:00:00.000Z",
  ultimoMensaje: "Hola",
  ...extra,
});

test("derivacionesPorAvisar: solo las no vistas, la más vieja primero", () => {
  const lista = [d("a", { desde: "2026-11-23T12:10:00.000Z" }), d("b", { desde: "2026-11-23T12:00:00.000Z" }), d("c")];
  const res = derivacionesPorAvisar(lista, new Set(["c"]));
  assert.deepEqual(res.map((x) => x.id), ["b", "a"]);
});

test("derivacionesPorAvisar: lista vacía o todo visto no avisa", () => {
  assert.deepEqual(derivacionesPorAvisar([], new Set()), []);
  assert.deepEqual(derivacionesPorAvisar([d("a")], new Set(["a"])), []);
});

test("podarVistos: olvida las conversaciones que ya no están derivadas (si se vuelve a derivar, avisa de nuevo)", () => {
  const vistos = new Set(["a", "b"]);
  const res = podarVistos(vistos, [d("a")]);
  assert.deepEqual([...res], ["a"]);
  assert.deepEqual([...vistos], ["a", "b"], "no muta el original");
});

test("recortarTexto: recorta a 80 con puntos suspensivos y colapsa espacios", () => {
  assert.equal(recortarTexto("hola   \n mundo"), "hola mundo");
  const largo = "x".repeat(200);
  const res = recortarTexto(largo);
  assert.equal(res.length, 80);
  assert.ok(res.endsWith("…"));
  assert.equal(recortarTexto(null), "");
});

test("nombreSeguro: usa el nombre; si es un teléfono, deja solo las últimas 4 cifras", () => {
  assert.equal(nombreSeguro("Ana Pérez", "5491130848283"), "Ana Pérez");
  assert.equal(nombreSeguro("5491130848283", "5491130848283"), "Cliente ***8283");
  assert.equal(nombreSeguro(null, "5491130848283"), "Cliente ***8283");
  assert.equal(nombreSeguro("+54 11 3084-8283", "x"), "Cliente ***8283");
  assert.equal(nombreSeguro(null, null), "Cliente sin nombre");
});

test("textoNotificacion", () => {
  assert.equal(textoNotificacion(d("a", { ultimoMensaje: "quiero hablar" })), "Ana: quiero hablar");
  assert.equal(textoNotificacion(d("a", { ultimoMensaje: "" })), "Ana pasó a atención humana");
});

test("vistos: leer/guardar tolera storage nulo, roto o que falla", () => {
  assert.deepEqual([...leerVistos(null)], []);
  assert.deepEqual([...leerVistos({ getItem: () => "{roto", setItem: () => undefined })], []);
  const guardado: string[] = [];
  guardarVistos({ getItem: () => null, setItem: (_k, v) => void guardado.push(v) }, new Set(["a"]));
  assert.equal(guardado[0], JSON.stringify(["a"]));
  assert.doesNotThrow(() =>
    guardarVistos({ getItem: () => null, setItem: () => { throw new Error("lleno"); } }, new Set(["a"])),
  );
});
