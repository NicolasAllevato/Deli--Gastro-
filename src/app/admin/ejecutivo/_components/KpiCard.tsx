import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { Trend } from "@/lib/reports/executive";
import { kpiStatus, type KpiKey, type KpiSetting, type KpiStatus } from "@/lib/reports/executiveSettings";
import { KPI_LABELS, formatKpi, formatTarget } from "./format";

interface Props {
  kpi: KpiKey;
  value: number | null;
  trend: Trend;
  setting: KpiSetting;
}

const STATUS: Record<KpiStatus, { text: string; color: string }> = {
  ok: { text: "En meta", color: "var(--ex-good)" },
  miss: { text: "Fuera de meta", color: "var(--ex-warn)" },
  alert: { text: "En alerta", color: "var(--ex-bad)" },
};

function trendColor(good: boolean | null): string {
  if (good === null) return "var(--ex-muted)";
  return good ? "var(--ex-good)" : "var(--ex-bad)";
}

function TrendBadge({ kpi, trend }: { kpi: KpiKey; trend: Trend }) {
  const Icon = trend.direction === "up" ? TrendingUp : trend.direction === "down" ? TrendingDown : Minus;
  const word = trend.direction === "up" ? "subió" : trend.direction === "down" ? "bajó" : "sin cambios";
  const verdict = trend.good === null ? "" : trend.good ? ", mejora" : ", empeora";
  const text = trend.delta === null ? "—" : trend.direction === "flat" ? "Igual" : formatKpi(kpi, Math.abs(trend.delta));
  return (
    <p className="exec-trend text-xs font-bold" style={{ color: trendColor(trend.good) }}>
      <Icon size={15} aria-hidden="true" />
      <span>{text}</span>
      <span className="sr-only">{`${word}${verdict} respecto del período anterior`}</span>
      <span className="exec-muted font-medium" aria-hidden="true">
        vs. anterior
      </span>
    </p>
  );
}

export function KpiCard({ kpi, value, trend, setting }: Props) {
  const status = STATUS[kpiStatus(setting, value)];
  return (
    <article className="exec-card p-3 sm:p-4 flex flex-col gap-2 [&:last-child:nth-child(odd)]:col-span-2 lg:[&:last-child:nth-child(odd)]:col-span-1" aria-label={KPI_LABELS[kpi]}>
      <h3 className="text-[11px] font-bold uppercase tracking-widest exec-muted">{KPI_LABELS[kpi]}</h3>
      <p className="text-2xl sm:text-3xl font-headline font-black leading-none">{formatKpi(kpi, value)}</p>
      <TrendBadge kpi={kpi} trend={trend} />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs mt-1">
        <span className="exec-muted">{formatTarget(kpi, setting)}</span>
        {value !== null && (
          <span className="font-bold" style={{ color: status.color }}>
            {status.text}
          </span>
        )}
      </div>
    </article>
  );
}
