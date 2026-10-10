import type {
  ExecutiveSettings,
  GoodDirection,
  KpiKey,
  KpiSetting,
  RuleId,
  ZoneSetting,
} from "@/lib/reports/executiveSettings";

/** Texto de un input numérico a número; vacío = NaN (la validación lo rechaza). */
export const toNumber = (raw: string): number => (raw.trim() === "" ? Number.NaN : Number(raw));
export const fromNumber = (n: number): string => (Number.isNaN(n) ? "" : String(n));

export function withKpi(d: ExecutiveSettings, key: KpiKey, patch: Partial<KpiSetting>): ExecutiveSettings {
  return { ...d, kpis: { ...d.kpis, [key]: { ...d.kpis[key], ...patch } } };
}

export const withDirection = (d: ExecutiveSettings, key: KpiKey, direction: GoodDirection) =>
  withKpi(d, key, { direction });

export function withSla(d: ExecutiveSettings, patch: Partial<Omit<ExecutiveSettings["sla"], "byZone">>): ExecutiveSettings {
  return { ...d, sla: { ...d.sla, ...patch } };
}

/** Override de SLA por zona; null lo quita. */
export function withZoneSla(d: ExecutiveSettings, id: string, minutes: number | null): ExecutiveSettings {
  const rest = Object.fromEntries(Object.entries(d.sla.byZone).filter(([k]) => k !== id));
  return { ...d, sla: { ...d.sla, byZone: minutes === null ? rest : { ...rest, [id]: minutes } } };
}

export function withZone(d: ExecutiveSettings, id: string, patch: Partial<ZoneSetting>): ExecutiveSettings {
  const base: ZoneSetting = Object.hasOwn(d.zones, id) ? d.zones[id] : { visible: true };
  const next: ZoneSetting = { ...base, ...patch };
  if (next.label !== undefined && next.label.trim() === "") delete next.label;
  return { ...d, zones: { ...d.zones, [id]: next } };
}

export function withRule(d: ExecutiveSettings, rule: RuleId, enabled: boolean): ExecutiveSettings {
  return { ...d, copilot: { ...d.copilot, rules: { ...d.copilot.rules, [rule]: enabled } } };
}

export function withDropPoints(d: ExecutiveSettings, dropPoints: number): ExecutiveSettings {
  return { ...d, copilot: { ...d.copilot, dropPoints } };
}

/** Zonas conocidas: las del filtro, las de los datos y las que ya tienen ajustes. */
export function knownZones(
  d: ExecutiveSettings,
  options: ReadonlyArray<{ id: string; label: string }>,
  rows: ReadonlyArray<{ zoneId: string; label: string }>,
): Array<{ id: string; label: string }> {
  const map = new Map<string, string>();
  for (const z of rows) map.set(z.zoneId, z.label);
  for (const z of options) map.set(z.id, z.label);
  for (const id of [...Object.keys(d.zones), ...Object.keys(d.sla.byZone)]) {
    if (!map.has(id)) map.set(id, d.zones[id]?.label ?? id);
  }
  return [...map].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
}
