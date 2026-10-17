"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ZoneRow } from "@/lib/reports/executive";
import { ChartCard } from "./ChartCard";
import { legendProps } from "./chartLegend";
import { chartPalette, tooltipStyle } from "./chartPalette";
import { compactMoney } from "./format";
import type { ExecTheme } from "./useExecTheme";

/** Abreviatura para el eje: "Z2 Zona cercana" -> "Z2"; el nombre completo queda en el tooltip. */
function shortZone(label: string): string {
  const code = /^[A-Za-z]{1,2}\d+(?=\s)/.exec(label.trim());
  if (code) return code[0];
  return label.length > 14 ? `${label.slice(0, 13)}…` : label;
}

interface Props {
  zones: ZoneRow[];
  theme: ExecTheme;
}

export function ZoneChart({ zones, theme }: Props) {
  const p = chartPalette(theme);
  const tick = { fill: p.axis, fontSize: 11 };

  return (
    <ChartCard
      title="Demanda y facturación por zona"
      subtitle="Pedidos (izquierda) y facturación (derecha)."
      empty={zones.length === 0}
      summary={`Barras de pedidos y facturación para ${zones.length} zonas.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={zones} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={p.grid} vertical={false} />
          <XAxis dataKey="label" tick={tick} stroke={p.grid} tickLine={false} interval={0} tickFormatter={shortZone} angle={-30} textAnchor="end" height={56} />
          <YAxis yAxisId="orders" tick={tick} stroke={p.grid} tickLine={false} width={40} allowDecimals={false} />
          <YAxis yAxisId="revenue" orientation="right" tick={tick} stroke={p.grid} tickLine={false} width={52} tickFormatter={compactMoney} />
          <Tooltip
            {...tooltipStyle(p)}
            cursor={{ fill: p.grid, opacity: 0.4 }}
            formatter={(value, name) => (name === "Facturación" ? compactMoney(Number(value)) : String(value))}
          />
          <Legend {...legendProps(p)} />
          <Bar yAxisId="orders" dataKey="orders" name="Pedidos" fill={p.series[0]} radius={[4, 4, 0, 0]} />
          <Bar yAxisId="revenue" dataKey="revenue" name="Facturación" fill={p.series[1]} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
