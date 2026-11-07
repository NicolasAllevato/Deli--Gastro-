"use client";

import { useState } from "react";
import { Settings } from "lucide-react";
import { DEFAULTS, KPI_KEYS, type KpiKey } from "@/lib/reports/executiveSettings";
import type { RangeKey } from "@/lib/reports/range";
import type { ExecutiveSnapshot, Kpis } from "@/lib/reports/executive";
import { formatKpi } from "./_components/format";
import { ChannelDonut } from "./_components/ChannelDonut";
import { CopilotCard } from "./_components/CopilotCard";
import { DataStatus } from "./_components/DataStatus";
import { FiltersBar } from "./_components/FiltersBar";
import { KpiCard } from "./_components/KpiCard";
import { PunctualityPrepChart } from "./_components/PunctualityPrepChart";
import { SettingsDrawer } from "./_components/SettingsDrawer";
import { EmptyView, ErrorView, LoadingView } from "./_components/StateViews";
import { ChannelResultsTable } from "./_components/ChannelResultsTable";
import { useExecTheme, type ExecTheme } from "./_components/useExecTheme";
import { useExecutiveData } from "./useExecutiveData";

/** Los KPI de tiempos siempre muestran minutos y porcentaje juntos. */
function kpiDetail(key: KpiKey, kpis: Kpis): string | undefined {
  if (key === "onTime") return `Tiempo total: ${formatKpi("prepMinutes", kpis.totalMinutes)}`;
  if (key === "prepMinutes") return `Dentro de meta: ${formatKpi("onTime", kpis.prepOnTarget)}`;
  return undefined;
}

function Dashboard({ data, settings, theme }: { data: ExecutiveSnapshot; settings: typeof DEFAULTS; theme: ExecTheme }) {
  const visible = KPI_KEYS.filter((k) => settings.kpis[k].visible);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {visible.map((k) => (
          <KpiCard key={k} kpi={k} value={data.kpis.current[k]} trend={data.trends[k]} setting={settings.kpis[k]} detail={kpiDetail(k, data.kpis.current)} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2 min-w-0">
        <CopilotCard insights={data.insights} />
        <ChannelDonut channels={data.channels} theme={theme} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 min-w-0">
        <PunctualityPrepChart series={data.series} theme={theme} />
        <ChannelResultsTable channels={data.channels} />
      </div>
    </div>
  );
}

export default function EjecutivoClient() {
  const [range, setRange] = useState<RangeKey | null>(null);
  const [zone, setZone] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme] = useExecTheme();
  const { data, settings, loading, error, refetch, saveSettings } = useExecutiveData({ range, zone });

  const activeRange = range ?? data?.range.key ?? null;
  const effective = settings ?? DEFAULTS;
  const isEmpty = data !== null && data.kpis.current.orders === 0;

  return (
    <div className="exec-theme exec-page p-4 sm:p-6 flex flex-col gap-4 min-w-0" data-theme={theme}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-headline font-black text-2xl">Tablero ejecutivo</h1>
          <p className="text-sm exec-muted">Indicadores clave, comparados con el período anterior.</p>
          <DataStatus loading={loading} error={error} orders={data?.kpis.current.orders ?? null} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="exec-chip" onClick={() => setSettingsOpen(true)}>
            <Settings size={15} aria-hidden="true" />
            Ajustes
          </button>
        </div>
      </header>

      <FiltersBar
        range={activeRange}
        zone={zone}
        zoneOptions={data?.zoneOptions ?? []}
        onRange={setRange}
        onZone={setZone}
      />

      <div aria-busy={loading} className="min-w-0">
        {error && !data ? (
          <ErrorView message={error} onRetry={refetch} />
        ) : !data ? (
          <LoadingView />
        ) : isEmpty ? (
          <EmptyView />
        ) : (
          <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            {error && <ErrorView message={error} onRetry={refetch} />}
            <Dashboard data={data} settings={effective} theme={theme} />
          </div>
        )}
      </div>

      <SettingsDrawer
        theme={theme}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        zoneOptions={data?.zoneOptions ?? []}
        zoneRows={data?.zones ?? []}
        saveSettings={saveSettings}
      />
    </div>
  );
}
