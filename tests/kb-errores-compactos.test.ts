/** Errores aprendidos (entrega 2): transiciones de estado validadas en el UPDATE y agrupación para la pantalla compacta. */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seed, actors } from "./helpers/sqlite-d1.ts";
import { systemActor } from "../src/lib/data/actor.ts";
import { decide, decisionSchema, ERROR_TRANSITIONS, listErrores, recordError, recordSugerencia, type Decision } from "../src/lib/data/kb-aprendizaje.ts";
import { d1BotRepo } from "../workers/whatsapp-bot/src/repo/d1.ts";
import { groupErrores, oneLine } from "../src/lib/kb/errores-view.ts";

const sys = systemActor("test");
const base = { escenario: "queja", tipo: "no_resolvio" as const, mensaje_cliente: "llegó frío", respuesta_mala: "Qué pena", motivo: "No derivó" };

let db: ReturnType<typeof createTestDb>;
beforeEach(() => {
  db = createTestDb();
  seed(db);
});

const estadoDe = async (id: string) => (await listErrores(db, actors.admin)).find((e) => e.id === id)?.estado;
const act = (id: string, accion: Decision["accion"], tipo: Decision["tipo"] = "error") => decide(db, actors.admin, { tipo, id, accion }, () => "x");

/** Un error en cada estado, llevándolo por transiciones válidas. */
async function errorEn(estado: "pendiente" | "aprobada" | "rechazada" | "desactivada", id: string, correccion = `Corrección ${id}`) {
  await recordError(db, sys, id, { ...base, correccion });
  if (estado === "pendiente") return;
  if (estado === "rechazada") return void (await act(id, "rechazar"));
  await act(id, "aprobar");
  if (estado === "desactivada") await act(id, "desactivar");
}

describe("decide(): transiciones de errores", () => {
  it("la tabla de transiciones es la acordada", () => {
    assert.deepEqual(ERROR_TRANSITIONS, {
      aprobar: { to: "aprobada", from: ["pendiente", "desactivada"] },
      rechazar: { to: "rechazada", from: ["pendiente"] },
      desactivar: { to: "desactivada", from: ["aprobada"] },
      reabrir: { to: "pendiente", from: ["rechazada", "desactivada"] },
    });
  });

  it("aprobar: solo desde pendiente o desactivada", async () => {
    await errorEn("pendiente", "p");
    await errorEn("desactivada", "d");
    await errorEn("aprobada", "a");
    await errorEn("rechazada", "r");
    assert.equal(await act("p", "aprobar"), true);
    assert.equal(await act("d", "aprobar"), true);
    assert.equal(await act("a", "aprobar"), false, "ya aprobada");
    assert.equal(await act("r", "aprobar"), false, "una rechazada se reabre primero");
    assert.equal(await estadoDe("p"), "aprobada");
    assert.equal(await estadoDe("d"), "aprobada");
    assert.equal(await estadoDe("r"), "rechazada");
  });

  it("rechazar: solo desde pendiente", async () => {
    await errorEn("pendiente", "p");
    await errorEn("aprobada", "a");
    await errorEn("desactivada", "d");
    await errorEn("rechazada", "r");
    assert.equal(await act("p", "rechazar"), true);
    assert.equal(await act("a", "rechazar"), false);
    assert.equal(await act("d", "rechazar"), false);
    assert.equal(await act("r", "rechazar"), false);
    assert.equal(await estadoDe("a"), "aprobada", "una aprobada no se rechaza por error");
  });

  it("desactivar: solo desde aprobada", async () => {
    await errorEn("aprobada", "a");
    await errorEn("pendiente", "p");
    await errorEn("rechazada", "r");
    await errorEn("desactivada", "d");
    assert.equal(await act("a", "desactivar"), true);
    assert.equal(await act("p", "desactivar"), false);
    assert.equal(await act("r", "desactivar"), false);
    assert.equal(await act("d", "desactivar"), false);
    assert.equal(await estadoDe("p"), "pendiente");
  });

  it("reabrir: una rechazada o desactivada vuelve a pendiente; pendiente y aprobada no", async () => {
    await errorEn("rechazada", "r");
    await errorEn("desactivada", "d");
    await errorEn("pendiente", "p");
    await errorEn("aprobada", "a");
    assert.equal(await act("r", "reabrir"), true);
    assert.equal(await act("d", "reabrir"), true);
    assert.equal(await act("p", "reabrir"), false);
    assert.equal(await act("a", "reabrir"), false);
    assert.equal(await estadoDe("r"), "pendiente");
    assert.equal(await estadoDe("d"), "pendiente");
    assert.equal(await estadoDe("a"), "aprobada");
  });

  it("un doble clic no pisa la decisión: la segunda vez devuelve false (la ruta responde 409)", async () => {
    await errorEn("pendiente", "p");
    assert.equal(await act("p", "aprobar"), true);
    assert.equal(await act("p", "aprobar"), false);
    assert.equal(await act("p", "rechazar"), false);
    assert.equal(await estadoDe("p"), "aprobada");
  });

  it("un id que no existe devuelve false", async () => {
    for (const accion of ["aprobar", "rechazar", "desactivar", "reabrir"] as const) assert.equal(await act("no-existe", accion), false, accion);
  });

  it("solo las aprobadas llegan al bot como lecciones", async () => {
    await errorEn("aprobada", "a", "Lección activa");
    await errorEn("pendiente", "p", "Lección pendiente");
    await errorEn("rechazada", "r", "Lección rechazada");
    const repo = d1BotRepo(db);
    assert.deepEqual(await repo.lessons!(), ["Lección activa"]);
    await act("a", "desactivar");
    assert.deepEqual(await repo.lessons!(), []);
    await act("a", "aprobar");
    assert.deepEqual(await repo.lessons!(), ["Lección activa"]);
  });

  it("las sugerencias no tienen desactivar ni reabrir", async () => {
    await recordSugerencia(db, sys, "s1", { categoria: "faq", tema: "¿Hay sin TACC?", contenido: "Sí" });
    assert.equal(await act("s1", "desactivar", "sugerencia"), false);
    assert.equal(await act("s1", "reabrir", "sugerencia"), false);
    assert.equal(await act("s1", "rechazar", "sugerencia"), true);
    assert.equal(await act("s1", "reabrir", "sugerencia"), false, "una rechazada tampoco se reabre (no hay botón)");
  });

  it("solo staff decide", async () => {
    await errorEn("pendiente", "p");
    await assert.rejects(decide(db, actors.ana, { tipo: "error", id: "p", accion: "aprobar" }, () => "x"));
    assert.equal(await estadoDe("p"), "pendiente");
  });

  it("la acción reabrir es válida para el esquema y lo desconocido no", () => {
    assert.equal(decisionSchema.safeParse({ tipo: "error", id: "e1", accion: "reabrir" }).success, true);
    assert.equal(decisionSchema.safeParse({ tipo: "error", id: "e1", accion: "borrar" }).success, false);
  });
});

describe("listErrores(): pendientes, aprobadas y después el historial", () => {
  it("ordena por estado antes que por frecuencia", async () => {
    await errorEn("rechazada", "r");
    await errorEn("desactivada", "d");
    await errorEn("aprobada", "a");
    await errorEn("pendiente", "p");
    // La rechazada es la más frecuente, pero el historial va al final.
    await recordError(db, sys, "otro", { ...base, correccion: "Corrección r" }, { veces: 50 });
    const estados = (await listErrores(db, actors.admin)).map((e) => e.estado);
    assert.deepEqual(estados, ["pendiente", "aprobada", ...estados.slice(2)]);
    assert.ok(estados.slice(2).every((e) => e === "rechazada" || e === "desactivada"));
  });
});

describe("pantalla compacta: agrupación y línea corta", () => {
  const e = (id: string, estado: "pendiente" | "aprobada" | "rechazada" | "desactivada") => ({ id, estado });

  it("reparte por estado conservando el orden", () => {
    const g = groupErrores([e("1", "aprobada"), e("2", "pendiente"), e("3", "desactivada"), e("4", "aprobada"), e("5", "rechazada"), e("6", "pendiente")]);
    assert.deepEqual(g.pendientes.map((x) => x.id), ["2", "6"]);
    assert.deepEqual(g.aprobados.map((x) => x.id), ["1", "4"]);
    assert.deepEqual(g.historial.map((x) => x.id), ["3", "5"]);
  });

  it("sin errores todo queda vacío", () => {
    assert.deepEqual(groupErrores([]), { pendientes: [], aprobados: [], historial: [] });
  });

  it("la línea corta junta espacios y saltos y trunca con «…»", () => {
    assert.equal(oneLine("Ante una queja,\n  empatizá   y derivá.", 100), "Ante una queja, empatizá y derivá.");
    const cut = oneLine("a".repeat(200), 50);
    assert.equal(cut.length, 50);
    assert.ok(cut.endsWith("…"));
    assert.equal(oneLine("corto", 50), "corto");
    assert.equal(oneLine("   ", 10), "");
  });
});
