import { z } from "zod";
import { RANGE_KEYS, type RangeKey } from "./range.ts";

/** Clave de `global_config` donde se guardan los ajustes del tablero ejecutivo. */
export const EXECUTIVE_SETTINGS_KEY = "executive_settings";

export const KPI_KEYS = ["onTime", "prepMinutes", "csat", "complaints", "avgTicket"] as const;
export type KpiKey = (typeof KPI_KEYS)[number];

export const RULE_IDS = ["kpiAlert", "kpiMiss", "zoneDrop", "zoneLate"] as const;
export type RuleId = (typeof RULE_IDS)[number];

export type GoodDirection = "higher" | "lower";
export type KpiStatus = "ok" | "miss" | "alert";

export interface KpiSetting {
  /** Meta del indicador (porcentaje, minutos, puntos o pesos según el KPI). */
  target: number;
  /** "higher": mejor cuanto más alto; "lower": mejor cuanto más bajo. */
  direction: GoodDirection;
  /** Valor a partir del cual el indicador pasa de "no llega a la meta" a alerta. */
  alertThreshold: number;
  visible: boolean;
}

export interface ZoneSetting {
  label?: string;
  visible: boolean;
}

export interface ExecutiveSettings {
  kpis: Record<KpiKey, KpiSetting>;
  sla: {
    /** Minutos prometidos por defecto. */
    defaultMinutes: number;
    /** Minutos de gracia antes de considerar un pedido tarde. */
    toleranceMinutes: number;
    /** Override de minutos prometidos por id de zona. */
    byZone: Record<string, number>;
  };
  zones: Record<string, ZoneSetting>;
  copilot: {
    rules: Record<RuleId, boolean>;
    /** Caída de puntualidad (puntos porcentuales) que dispara una alerta de zona. */
    dropPoints: number;
  };
  defaultRange: RangeKey;
}

export const DEFAULTS: ExecutiveSettings = {
  kpis: {
    onTime: { target: 90, direction: "higher", alertThreshold: 80, visible: true },
    prepMinutes: { target: 18, direction: "lower", alertThreshold: 25, visible: true },
    csat: { target: 4.5, direction: "higher", alertThreshold: 4, visible: true },
    complaints: { target: 3, direction: "lower", alertThreshold: 6, visible: true },
    avgTicket: { target: 8000, direction: "higher", alertThreshold: 5000, visible: true },
  },
  sla: { defaultMinutes: 40, toleranceMinutes: 5, byZone: {} },
  zones: {},
  copilot: {
    rules: { kpiAlert: true, kpiMiss: true, zoneDrop: true, zoneLate: true },
    dropPoints: 10,
  },
  defaultRange: "last_7_days",
};

const PERCENT_KPIS: readonly KpiKey[] = ["onTime", "complaints"];

const kpiShape = (max: number) => ({
  target: z.number().min(0).max(max),
  direction: z.enum(["higher", "lower"]),
  alertThreshold: z.number().min(0).max(max),
  visible: z.boolean(),
});

const MAX_BY_KPI: Record<KpiKey, number> = {
  onTime: 100, prepMinutes: 600, csat: 5, complaints: 100, avgTicket: 10_000_000,
};

/** Ids de zona: solo letras, números, guion y guion bajo (evita claves raras como rutas o prototipos). */
export const ZONE_ID_PATTERN = /^[\w-]{1,64}$/;
const zoneId = z.string().regex(ZONE_ID_PATTERN);
const minutes = z.number().int().min(1).max(600);
const label = z.string().trim().min(1).max(40);
const zonesRecord = z.record(zoneId, z.object({ label: label.optional(), visible: z.boolean() }));
const slaByZone = z.record(zoneId, minutes);
const rangeKey = z.enum(RANGE_KEYS as [RangeKey, ...RangeKey[]]);
const ruleShape = Object.fromEntries(RULE_IDS.map((r) => [r, z.boolean()])) as Record<RuleId, z.ZodBoolean>;

const kpiEntry = (k: KpiKey) => z.object(kpiShape(MAX_BY_KPI[k]));
const kpisShape = Object.fromEntries(KPI_KEYS.map((k) => [k, kpiEntry(k)])) as Record<KpiKey, ReturnType<typeof kpiEntry>>;
const kpisPatchShape = Object.fromEntries(
  KPI_KEYS.map((k) => [k, kpiEntry(k).partial().optional()]),
) as unknown as Record<KpiKey, z.ZodOptional<z.ZodObject<Partial<ReturnType<typeof kpiShape>>>>>;

const MAX_ZONES = 50;

/** Ajustes completos: se usa para validar el resultado final del merge. */
export const settingsSchema = z
  .object({
    kpis: z.object(kpisShape),
    sla: z.object({ defaultMinutes: minutes, toleranceMinutes: z.number().int().min(0).max(120), byZone: slaByZone }),
    zones: zonesRecord,
    copilot: z.object({ rules: z.object(ruleShape), dropPoints: z.number().min(1).max(100) }),
    defaultRange: rangeKey,
  })
  .superRefine((s, ctx) => {
    for (const k of KPI_KEYS) {
      const { target, alertThreshold, direction } = s.kpis[k];
      const coherent = direction === "higher" ? alertThreshold <= target : alertThreshold >= target;
      if (!coherent) {
        ctx.addIssue({ code: "custom", path: ["kpis", k, "alertThreshold"], message: "El umbral de alerta tiene que ser peor o igual que la meta." });
      }
    }
    if (Object.keys(s.zones).length > MAX_ZONES || Object.keys(s.sla.byZone).length > MAX_ZONES) {
      ctx.addIssue({ code: "custom", path: ["zones"], message: `Máximo ${MAX_ZONES} zonas.` });
    }
  });

/** Parche parcial: lo que puede mandar el panel de ajustes. */
export const settingsPatchSchema = z.object({
  kpis: z.object(kpisPatchShape).partial().optional(),
  sla: z.object({ defaultMinutes: minutes, toleranceMinutes: z.number().int().min(0).max(120), byZone: slaByZone }).partial().optional(),
  zones: zonesRecord.optional(),
  copilot: z.object({ rules: z.object(ruleShape).partial().optional(), dropPoints: z.number().min(1).max(100).optional() }).optional(),
  defaultRange: rangeKey.optional(),
});

export type ExecutiveSettingsPatch = z.infer<typeof settingsPatchSchema>;

export type ParseResult =
  | { ok: true; settings: ExecutiveSettings }
  | { ok: false; error: string };

const withoutUndefined = <T extends object>(obj: T | undefined): Partial<T> =>
  Object.fromEntries(Object.entries(obj ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;

/** Combina un parche sobre una base sin mutar ninguna de las dos. */
export function mergeSettings(base: ExecutiveSettings, patch: ExecutiveSettingsPatch): ExecutiveSettings {
  const kpis = Object.fromEntries(
    KPI_KEYS.map((k) => [k, { ...base.kpis[k], ...withoutUndefined(patch.kpis?.[k]) }]),
  ) as Record<KpiKey, KpiSetting>;

  return {
    kpis,
    sla: {
      defaultMinutes: patch.sla?.defaultMinutes ?? base.sla.defaultMinutes,
      toleranceMinutes: patch.sla?.toleranceMinutes ?? base.sla.toleranceMinutes,
      byZone: { ...(patch.sla?.byZone ?? base.sla.byZone) },
    },
    zones: Object.fromEntries(Object.entries(patch.zones ?? base.zones).map(([id, z]) => [id, { ...z }])),
    copilot: {
      rules: { ...base.copilot.rules, ...withoutUndefined(patch.copilot?.rules) },
      dropPoints: patch.copilot?.dropPoints ?? base.copilot.dropPoints,
    },
    defaultRange: patch.defaultRange ?? base.defaultRange,
  };
}

const firstIssue = (error: z.ZodError): string => {
  const issue = error.issues[0];
  return issue ? `${issue.path.join(".") || "ajustes"}: ${issue.message}` : "Ajustes inválidos.";
};

/** Valida un parche externo y lo aplica sobre `base` (por defecto, DEFAULTS). */
export function parseSettings(input: unknown, base: ExecutiveSettings = DEFAULTS): ParseResult {
  const patch = settingsPatchSchema.safeParse(input);
  if (!patch.success) return { ok: false, error: firstIssue(patch.error) };
  const merged = settingsSchema.safeParse(mergeSettings(base, patch.data));
  if (!merged.success) return { ok: false, error: firstIssue(merged.error) };
  return { ok: true, settings: merged.data };
}

/** Lee lo guardado en `global_config` (JSON o texto). Si está roto, vuelve a los valores por defecto. */
export function settingsFromStored(raw: unknown): ExecutiveSettings {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      console.error("[executive-settings] lo guardado en global_config no es JSON válido; se usan los valores por defecto.");
      return DEFAULTS;
    }
  }
  if (value === null || value === undefined) return DEFAULTS;
  const parsed = parseSettings(value);
  if (parsed.ok) return parsed.settings;
  console.error(`[executive-settings] lo guardado ya no valida (${parsed.error}); se recupera campo por campo.`);
  return recoverSettings(value);
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Aplica sobre DEFAULTS solo los campos del valor guardado que validan, uno por uno. */
function recoverSettings(value: unknown): ExecutiveSettings {
  const stored = asRecord(value);
  let result = DEFAULTS;
  const apply = (patch: unknown) => {
    const parsed = parseSettings(patch, result);
    if (parsed.ok) result = parsed.settings;
    return parsed.ok;
  };

  const kpis = asRecord(stored.kpis);
  for (const key of KPI_KEYS) {
    const entry = asRecord(kpis[key]);
    if (apply({ kpis: { [key]: entry } })) continue;
    for (const [prop, v] of Object.entries(entry)) apply({ kpis: { [key]: { [prop]: v } } });
  }
  const sla = asRecord(stored.sla);
  for (const prop of ["defaultMinutes", "toleranceMinutes", "byZone"]) {
    if (prop in sla) apply({ sla: { [prop]: sla[prop] } });
  }
  if (stored.zones !== undefined) apply({ zones: stored.zones });
  const copilot = asRecord(stored.copilot);
  if ("dropPoints" in copilot) apply({ copilot: { dropPoints: copilot.dropPoints } });
  const rules = asRecord(copilot.rules);
  for (const rule of RULE_IDS) {
    if (rule in rules) apply({ copilot: { rules: { [rule]: rules[rule] } } });
  }
  if (stored.defaultRange !== undefined) apply({ defaultRange: stored.defaultRange });
  return result;
}

/** Minutos prometidos para una zona (override por zona o el valor por defecto). */
export function slaForZone(settings: ExecutiveSettings, zone: string | null | undefined): number {
  if (zone && Object.hasOwn(settings.sla.byZone, zone)) return settings.sla.byZone[zone];
  return settings.sla.defaultMinutes;
}

/** Nombre a mostrar: etiqueta configurada, nombre real de la zona o el id. */
export function zoneLabel(
  settings: ExecutiveSettings,
  id: string,
  names: Readonly<Record<string, string>> = {},
): string {
  const configured = Object.hasOwn(settings.zones, id) ? settings.zones[id]?.label : undefined;
  if (configured !== undefined) return configured;
  return Object.hasOwn(names, id) ? names[id] : id;
}

export function isZoneVisible(settings: ExecutiveSettings, id: string): boolean {
  return Object.hasOwn(settings.zones, id) ? settings.zones[id].visible : true;
}

/** Estado de un valor frente a la meta y el umbral de alerta del KPI. */
export function kpiStatus(setting: KpiSetting, value: number | null): KpiStatus {
  if (value === null) return "ok";
  const sign = setting.direction === "higher" ? 1 : -1;
  if (sign * (value - setting.target) >= 0) return "ok";
  return sign * (value - setting.alertThreshold) < 0 ? "alert" : "miss";
}

export { PERCENT_KPIS };

/**
 * Lee el body como stream y corta al superar el máximo en BYTES, sin confiar en content-length.
 * Devuelve undefined si es demasiado grande o no es JSON.
 */
export async function readLimitedJson(req: Request, maxBytes: number): Promise<unknown | undefined> {
  const reader = req.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(value);
    }
  } catch {
    return undefined;
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}
