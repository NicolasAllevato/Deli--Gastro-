import { test } from "node:test";
import assert from "node:assert/strict";
import {
  armarNotificaciones,
  contarNoVistas,
  deDerivacion,
  deHabilitacion,
  dePedido,
  deReclamo,
  fechaMasNueva,
  haceCuanto,
} from "../src/lib/notificaciones/armado.ts";

test("pedido: título con 8 caracteres en mayúsculas y total en pesos", () => {
  const n = dePedido({ id: "abcdef12-3456", clientName: "Ana", total: 12500, createdAt: "2026-11-24T10:00:00.000Z" });
  assert.equal(n.titulo, "Pedido nuevo #ABCDEF12");
  assert.match(n.detalle, /^Ana · \$\s?12\.500$/);
  assert.equal(n.href, "/admin/tablero");
  assert.equal(n.tipo, "pedido");
});

test("pedido sin nombre usa «Cliente»", () => {
  assert.match(dePedido({ id: "x", clientName: "  ", total: 0, createdAt: "" }).detalle, /^Cliente · /);
});

test("derivación: href con id codificado y detalle con último mensaje", () => {
  const n = deDerivacion({ id: "a b", nombre: "Juan", ultimoMensaje: "hola", desde: "2026-11-24T10:00:00Z" });
  assert.equal(n.href, "/admin/conversaciones?id=a%20b");
  assert.equal(n.detalle, "Juan: hola");
  assert.equal(deDerivacion({ id: "1", nombre: "Juan", ultimoMensaje: "", desde: "" }).detalle, "Juan");
});

test("reclamo: título por estado y motivo recortado a 80", () => {
  const largo = "x".repeat(200);
  const n = deReclamo({ id: "r1", estado: "en_curso", motivo: largo, createdAt: "" });
  assert.equal(n.titulo, "Reclamo en curso");
  assert.equal(n.detalle.length, 80);
  assert.ok(n.detalle.endsWith("…"));
  assert.equal(deReclamo({ id: "r2", estado: "abierto", motivo: "frío", createdAt: "" }).titulo, "Reclamo abierto");
});

test("habilitación", () => {
  const n = deHabilitacion({ id: "s1", courierName: "Pedro", requestedAt: "" });
  assert.equal(n.titulo, "Repartidor pide habilitación");
  assert.equal(n.detalle, "Pedro");
  assert.equal(n.href, "/admin/repartidores");
});

test("armar: ordena por fecha desc, recorta y cuenta el total", () => {
  const a = deHabilitacion({ id: "a", courierName: "A", requestedAt: "2026-11-24T08:00:00Z" });
  const b = deHabilitacion({ id: "b", courierName: "B", requestedAt: "2026-11-24T10:00:00Z" });
  const c = deHabilitacion({ id: "c", courierName: "C", requestedAt: "2026-11-24T09:00:00Z" });
  const r = armarNotificaciones([[a], [b, c]], 2);
  assert.deepEqual(r.items.map((n) => n.id), ["habilitacion-b", "habilitacion-c"]);
  assert.equal(r.total, 3);
});

test("no vistas según «visto hasta»", () => {
  const items = [
    deHabilitacion({ id: "a", courierName: "A", requestedAt: "2026-11-24T08:00:00Z" }),
    deHabilitacion({ id: "b", courierName: "B", requestedAt: "2026-11-24T10:00:00Z" }),
  ];
  assert.equal(contarNoVistas(items, null), 2);
  assert.equal(contarNoVistas(items, "basura"), 2);
  assert.equal(contarNoVistas(items, "2026-11-24T09:00:00Z"), 1);
  assert.equal(contarNoVistas(items, "2026-11-24T10:00:00Z"), 0);
  assert.equal(fechaMasNueva(items), "2026-11-24T10:00:00.000Z");
  assert.equal(fechaMasNueva([]), null);
});

test("hora relativa en español", () => {
  const ahora = new Date("2026-11-24T12:00:00Z");
  assert.equal(haceCuanto("2026-11-24T11:59:30Z", ahora), "recién");
  assert.equal(haceCuanto("2026-11-24T11:55:00Z", ahora), "hace 5 min");
  assert.equal(haceCuanto("2026-11-24T09:00:00Z", ahora), "hace 3 h");
  assert.equal(haceCuanto("2026-11-23T11:00:00Z", ahora), "hace 1 día");
  assert.equal(haceCuanto("2026-11-20T11:00:00Z", ahora), "hace 4 días");
});
