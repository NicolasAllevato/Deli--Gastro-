import { formatMoney } from "@/lib/orders";
import type { KpiKey, KpiSetting } from "@/lib/reports/executiveSettings";

export const KPI_LABELS: Record<KpiKey, string> = {
  onTime: "Entregas a tiempo",
  prepMinutes: "Preparación promedio",
  csat: "Satisfacción (CSAT)",
  complaints: "Reclamos",
  avgTicket: "Ticket promedio",
};

export const CHANNEL_LABELS: Record<string, string> = {
  web: "Web",
  whatsapp: "WhatsApp",
  mostrador: "Mostrador",
  fudo: "Fudo",
};

const nf = (n: number, digits = 1) => n.toLocaleString("es-AR", { maximumFractionDigits: digits });

/** Valor legible de un KPI; null se muestra como raya. */
export function formatKpi(key: KpiKey, value: number | null): string {
  if (value === null) return "—";
  switch (key) {
    case "onTime":
    case "complaints":
      return `${nf(value)}%`;
    case "prepMinutes":
      return `${nf(value)} min`;
    case "csat":
      return nf(value, 2);
    case "avgTicket":
      return formatMoney(Math.round(value));
  }
}

/** Meta con su sentido, por ejemplo "Meta ≥ 90%" o "Meta ≤ 18 min". */
export function formatTarget(key: KpiKey, setting: KpiSetting): string {
  const sign = setting.direction === "higher" ? "≥" : "≤";
  return `Meta ${sign} ${formatKpi(key, setting.target)}`;
}

/** "2026-10-03" -> "03/10" */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

export function compactMoney(n: number): string {
  if (n >= 1_000_000) return `$${nf(n / 1_000_000)} M`;
  if (n >= 1000) return `$${nf(n / 1000, 0)} k`;
  return `$${n}`;
}
