import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULTS,
  EXECUTIVE_SETTINGS_KEY,
  isZoneVisible,
  kpiStatus,
  mergeSettings,
  parseSettings,
  readLimitedJson,
  settingsFromStored,
  slaForZone,
  zoneLabel,
} from "../src/lib/reports/executiveSettings.ts";

describe("executiveSettings: defaults", () => {
  it("usa la clave de global_config acordada", () => {
    assert.equal(EXECUTIVE_SETTINGS_KEY, "executive_settings");
  });

  it("trae las metas del plan", () => {
    assert.deepEqual([DEFAULTS.kpis.onTime.target, DEFAULTS.kpis.onTime.direction], [90, "higher"]);
    assert.deepEqual([DEFAULTS.kpis.prepMinutes.target, DEFAULTS.kpis.prepMinutes.direction], [18, "lower"]);
    assert.deepEqual([DEFAULTS.kpis.csat.target, DEFAULTS.kpis.csat.direction], [4.5, "higher"]);
    assert.deepEqual([DEFAULTS.kpis.complaints.target, DEFAULTS.kpis.complaints.direction], [3, "lower"]);
  });

  it("los defaults pasan su propia validación", () => {
    const parsed = parseSettings({});
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.settings, DEFAULTS);
  });
});

describe("mergeSettings", () => {
  it("combina sin mutar la base ni el parche", () => {
    const base = structuredClone(DEFAULTS);
    const patch = { kpis: { onTime: { target: 95 } }, sla: { toleranceMinutes: 10 } };
    const patchCopy = structuredClone(patch);
    const merged = mergeSettings(base, patch);

    assert.equal(merged.kpis.onTime.target, 95);
    assert.equal(merged.kpis.onTime.alertThreshold, DEFAULTS.kpis.onTime.alertThreshold);
    assert.equal(merged.sla.toleranceMinutes, 10);
    assert.equal(merged.sla.defaultMinutes, DEFAULTS.sla.defaultMinutes);
    assert.deepEqual(base, DEFAULTS);
    assert.deepEqual(patch, patchCopy);
    assert.notEqual(merged.kpis, base.kpis);
    assert.notEqual(merged.sla.byZone, base.sla.byZone);
  });

  it("ignora campos undefined del parche", () => {
    const merged = mergeSettings(DEFAULTS, { kpis: { csat: { target: undefined, visible: false } } });
    assert.equal(merged.kpis.csat.target, 4.5);
    assert.equal(merged.kpis.csat.visible, false);
  });

  it("mezcla reglas del copiloto de a una", () => {
    const merged = mergeSettings(DEFAULTS, { copilot: { rules: { zoneDrop: false } } });
    assert.equal(merged.copilot.rules.zoneDrop, false);
    assert.equal(merged.copilot.rules.kpiAlert, true);
  });
});

describe("parseSettings: validación", () => {
  it("rechaza tipos incorrectos", () => {
    assert.equal(parseSettings({ kpis: { onTime: { target: "alto" } } }).ok, false);
    assert.equal(parseSettings({ defaultRange: "ayer_a_la_tarde" }).ok, false);
  });

  it("rechaza valores fuera de rango", () => {
    assert.equal(parseSettings({ kpis: { onTime: { target: 150 } } }).ok, false);
    assert.equal(parseSettings({ sla: { defaultMinutes: 0 } }).ok, false);
    assert.equal(parseSettings({ sla: { toleranceMinutes: -1 } }).ok, false);
    assert.equal(parseSettings({ copilot: { dropPoints: 0 } }).ok, false);
  });

  it("rechaza un umbral de alerta mejor que la meta", () => {
    const res = parseSettings({ kpis: { onTime: { target: 90, alertThreshold: 95 } } });
    assert.equal(res.ok, false);
    const lower = parseSettings({ kpis: { prepMinutes: { target: 18, alertThreshold: 10 } } });
    assert.equal(lower.ok, false);
  });

  it("devuelve un mensaje de error legible", () => {
    const res = parseSettings({ kpis: { onTime: { target: 150 } } });
    assert.ok(!res.ok);
    assert.match(res.error, /kpis\.onTime\.target/);
  });

  it("acepta ajustes válidos y no toca los DEFAULTS", () => {
    const res = parseSettings({
      sla: { defaultMinutes: 35, byZone: { Z3: 55 } },
      zones: { Z2: { label: "Centro", visible: false } },
      defaultRange: "today",
    });
    assert.ok(res.ok);
    assert.equal(res.settings.sla.defaultMinutes, 35);
    assert.equal(res.settings.defaultRange, "today");
    assert.deepEqual(DEFAULTS.sla.byZone, {});
  });

  it("rechaza datos que no son un objeto", () => {
    assert.equal(parseSettings("hola").ok, false);
    assert.equal(parseSettings(null).ok, false);
  });
});

describe("settingsFromStored", () => {
  it("lee JSON guardado y objetos", () => {
    const fromString = settingsFromStored(JSON.stringify({ sla: { defaultMinutes: 30 } }));
    assert.equal(fromString.sla.defaultMinutes, 30);
    assert.equal(settingsFromStored({ sla: { defaultMinutes: 25 } }).sla.defaultMinutes, 25);
  });

  it("vuelve a los defaults si falta o está roto", () => {
    assert.deepEqual(settingsFromStored(undefined), DEFAULTS);
    assert.deepEqual(settingsFromStored("{roto"), DEFAULTS);
    assert.deepEqual(settingsFromStored({ sla: { defaultMinutes: -5 } }), DEFAULTS);
  });
});

describe("slaForZone y helpers de zona", () => {
  const settings = mergeSettings(DEFAULTS, {
    sla: { byZone: { Z3: 55 } },
    zones: { Z2: { label: "Centro", visible: true }, Z5: { visible: false } },
  });

  it("usa el override de la zona o el SLA por defecto", () => {
    assert.equal(slaForZone(settings, "Z3"), 55);
    assert.equal(slaForZone(settings, "Z1"), DEFAULTS.sla.defaultMinutes);
    assert.equal(slaForZone(settings, null), DEFAULTS.sla.defaultMinutes);
    assert.equal(slaForZone(settings, "constructor"), DEFAULTS.sla.defaultMinutes);
  });

  it("resuelve etiqueta y visibilidad", () => {
    assert.equal(zoneLabel(settings, "Z2"), "Centro");
    assert.equal(zoneLabel(settings, "Z1", { Z1: "Norte" }), "Norte");
    assert.equal(zoneLabel(settings, "Z9"), "Z9");
    assert.equal(isZoneVisible(settings, "Z5"), false);
    assert.equal(isZoneVisible(settings, "Z1"), true);
  });
});

describe("kpiStatus", () => {
  it("meta alta: ok, no llega, alerta", () => {
    const s = DEFAULTS.kpis.onTime; // meta 90, alerta 80
    assert.equal(kpiStatus(s, 92), "ok");
    assert.equal(kpiStatus(s, 90), "ok");
    assert.equal(kpiStatus(s, 85), "miss");
    assert.equal(kpiStatus(s, 80), "miss");
    assert.equal(kpiStatus(s, 79), "alert");
  });

  it("meta baja: ok, no llega, alerta", () => {
    const s = DEFAULTS.kpis.prepMinutes; // meta 18, alerta 25
    assert.equal(kpiStatus(s, 15), "ok");
    assert.equal(kpiStatus(s, 22), "miss");
    assert.equal(kpiStatus(s, 26), "alert");
  });

  it("sin dato no alerta", () => {
    assert.equal(kpiStatus(DEFAULTS.kpis.csat, null), "ok");
  });
});

describe("ids de zona y prototipos", () => {
  it("rechaza ids de zona fuera de /^[\\w-]{1,64}$/", () => {
    assert.equal(parseSettings({ zones: { "a b": { visible: true } } }).ok, false);
    assert.equal(parseSettings({ sla: { byZone: { "../x": 30 } } }).ok, false);
    assert.equal(parseSettings({ zones: { "Z-1_a": { visible: true } } }).ok, true);
  });

  it("zoneLabel, isZoneVisible y slaForZone ignoran claves heredadas", () => {
    assert.equal(zoneLabel(DEFAULTS, "constructor"), "constructor");
    assert.equal(zoneLabel(DEFAULTS, "__proto__", {}), "__proto__");
    assert.equal(zoneLabel(DEFAULTS, "toString", {}), "toString");
    assert.equal(isZoneVisible(DEFAULTS, "constructor"), true);
    assert.equal(isZoneVisible(DEFAULTS, "__proto__"), true);
    assert.equal(slaForZone(DEFAULTS, "constructor"), DEFAULTS.sla.defaultMinutes);
  });

  it("una zona llamada 'constructor' guardada de verdad sí se respeta", () => {
    const s = mergeSettings(DEFAULTS, { zones: { constructor: { label: "Raro", visible: false } } });
    assert.equal(zoneLabel(s, "constructor"), "Raro");
    assert.equal(isZoneVisible(s, "constructor"), false);
  });
});

describe("settingsFromStored: recuperación campo por campo", () => {
  it("conserva lo válido y descarta solo lo roto, avisando por console.error", () => {
    const calls: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { calls.push(args); };
    try {
      const stored = {
        ...structuredClone(DEFAULTS),
        sla: { defaultMinutes: 55, toleranceMinutes: 9999, byZone: {} },
        defaultRange: "last_30_days",
      };
      const s = settingsFromStored(stored);
      assert.equal(s.sla.defaultMinutes, 55);
      assert.equal(s.sla.toleranceMinutes, DEFAULTS.sla.toleranceMinutes);
      assert.equal(s.defaultRange, "last_30_days");
      assert.equal(calls.length, 1);
    } finally {
      console.error = original;
    }
  });
});

describe("readLimitedJson", () => {
  const post = (body: BodyInit, headers: Record<string, string> = {}) =>
    new Request("http://x.test/", { method: "PUT", body, headers });

  it("lee JSON dentro del tope", async () => {
    assert.deepEqual(await readLimitedJson(post('{"a":1}'), 100), { a: 1 });
  });

  it("corta por bytes aunque content-length mienta (multibyte)", async () => {
    const body = JSON.stringify({ t: "ñ".repeat(60) });
    assert.ok(body.length < 100 && new TextEncoder().encode(body).length > 100);
    assert.equal(await readLimitedJson(post(body, { "content-length": "5" }), 100), undefined);
  });

  it("devuelve undefined si no es JSON", async () => {
    assert.equal(await readLimitedJson(post("nope"), 100), undefined);
  });
});
