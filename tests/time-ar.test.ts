/**
 * Horario argentino en toda la app: el helper único y una guarda que falla si
 * alguien vuelve a formatear una fecha con toLocale*String sin pasar por él.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AR_TZ, formatDateTimeAR, formatDateAR, formatTimeAR, dayKeyAR, isSameDayAR, startOfDayAR, startOfDayKeyAR,
} from "../src/lib/time-ar.ts";

// Venta 46635 de Fudo: createdAt 2026-11-13T18:23:27Z → 15:23 en Argentina.
const VENTA = "2026-11-13T18:23:27Z";

describe("helper de hora argentina", () => {
  it("2026-11-13T18:23:27Z se muestra 15:23", () => {
    assert.equal(formatTimeAR(VENTA, { hour: "2-digit", minute: "2-digit", hour12: false }), "15:23");
    assert.match(formatDateTimeAR(VENTA, { dateStyle: "short", timeStyle: "short" }), /13\/11\/(2026|26).*3:23|15:23/);
    assert.ok(!formatDateTimeAR(VENTA).includes("6:23"), "nunca la hora UTC");
  });
  it("acepta Date, string ISO y milisegundos", () => {
    const ms = Date.parse(VENTA);
    const a = formatTimeAR(VENTA, { hour: "2-digit", minute: "2-digit", hour12: false });
    assert.equal(formatTimeAR(new Date(ms), { hour: "2-digit", minute: "2-digit", hour12: false }), a);
    assert.equal(formatTimeAR(ms, { hour: "2-digit", minute: "2-digit", hour12: false }), a);
  });
  it("la zona del pedido no se puede pisar con opciones", () => {
    assert.equal(formatTimeAR(VENTA, { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false }), "15:23");
  });
  it("el día cambia a las 03:00 UTC", () => {
    assert.equal(dayKeyAR("2026-11-14T02:59:59Z"), "2026-11-13");
    assert.equal(dayKeyAR("2026-11-14T03:00:00Z"), "2026-11-14");
    assert.equal(formatDateAR("2026-11-14T02:59:59Z", { day: "2-digit", month: "2-digit" }), "13/11");
    assert.equal(isSameDayAR("2026-11-13T03:00:00Z", "2026-11-14T02:59:59Z"), true);
    assert.equal(isSameDayAR("2026-11-13T02:59:59Z", "2026-11-13T03:00:00Z"), false);
  });
  it("medianoche argentina y desplazamientos de día", () => {
    assert.equal(startOfDayAR(VENTA).toISOString(), "2026-11-13T03:00:00.000Z");
    assert.equal(startOfDayAR(VENTA, 1).toISOString(), "2026-11-14T03:00:00.000Z");
    assert.equal(startOfDayKeyAR("2026-12-31", 1).toISOString(), "2027-01-01T03:00:00.000Z");
    assert.throws(() => startOfDayKeyAR("13/11/2026"));
    assert.equal(AR_TZ, "America/Argentina/Buenos_Aires");
  });
});

describe("guarda: ninguna fecha se formatea fuera del helper", () => {
  const ROOT = fileURLToPath(new URL("..", import.meta.url));
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      if (n === "node_modules" || n.startsWith(".")) return [];
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
    });
  const files = walk(join(ROOT, "src")).filter((f) => !f.endsWith(join("lib", "time-ar.ts")));

  it("sin toLocaleDateString/toLocaleTimeString fuera de src/lib/time-ar.ts", () => {
    const bad = files.filter((f) => /\.toLocale(Date|Time)String\(/.test(readFileSync(f, "utf8")));
    assert.deepEqual(bad.map((f) => relative(ROOT, f)), []);
  });
  it("sin toLocaleString de fechas (Date o con opciones de fecha/hora)", () => {
    const DATE_OPTS = /toLocaleString\([^)]*\b(dateStyle|timeStyle|hour|minute|weekday|month|day|timeZone)\b/;
    const ON_DATE = /(new Date\([^)]*\)|\bDate\.now\(\))\.toLocaleString\(/;
    const bad = files.filter((f) => {
      const s = readFileSync(f, "utf8");
      return DATE_OPTS.test(s) || ON_DATE.test(s);
    });
    assert.deepEqual(bad.map((f) => relative(ROOT, f)), []);
  });
});
