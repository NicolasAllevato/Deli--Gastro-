"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DailyPoint } from "@/lib/reports/executive";
import { ChartCard } from "./ChartCard";
import { legendProps } from "./chartLegend";
import { chartPalette, tooltipStyle } from "./chartPalette";
import { shortDate } from "./format";
import type { ExecTheme } from "./useExecTheme";

interface Props {
  series: DailyPoint[];
  theme: ExecTheme;
}

export function PunctualityPrepChart({ series, theme }: Props) {
  const p = chartPalette(theme);
  const tick = { fill: p.axis, fontSize: 11 };
  const hasData = series.some((d) => d.onTime !== null || d.prepMinutes !== null);

  return (
    <ChartCard
      title="Puntualidad y preparación"
      subtitle="Por día: % de entregas a tiempo y minutos de preparación."
      empty={!hasData}
      summary={`Líneas de puntualidad y preparación para ${series.length} días.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={p.grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={tick} stroke={p.grid} tickLine={false} />
          <YAxis yAxisId="pct" domain={[0, 100]} tick={tick} stroke={p.grid} tickLine={false} unit="%" width={44} />
          <YAxis yAxisId="min" orientation="right" tick={tick} stroke={p.grid} tickLine={false} unit="m" width={40} />
          <Tooltip {...tooltipStyle(p)} labelFormatter={(v) => shortDate(String(v))} />
          <Legend {...legendProps(p)} />
          <Line yAxisId="pct" type="monotone" dataKey="onTime" name="A tiempo (%)" stroke={p.series[0]} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
          <Line yAxisId="min" type="monotone" dataKey="prepMinutes" name="Preparación (min)" stroke={p.series[2]} strokeWidth={2.5} strokeDasharray="5 3" dot={{ r: 3 }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
