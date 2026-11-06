"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { ChannelRow } from "@/lib/reports/executive";
import { ChartCard } from "./ChartCard";
import { legendProps } from "./chartLegend";
import { chartPalette, tooltipStyle } from "./chartPalette";
import { CHANNEL_LABELS } from "./format";
import type { ExecTheme } from "./useExecTheme";

interface Props {
  channels: ChannelRow[];
  theme: ExecTheme;
}

export function ChannelDonut({ channels, theme }: Props) {
  const p = chartPalette(theme);
  const data = channels.filter((c) => c.orders > 0).map((c) => ({ ...c, name: CHANNEL_LABELS[c.channel] ?? c.channel }));
  const surface = theme === "dark" ? "#151e30" : "#ffffff";

  return (
    <ChartCard
      title="Ventas por canal"
      subtitle="Participación de cada canal: web, WhatsApp, mostrador, PedidosYa, Rappi, Morfy y Fudo (delivery, take away y salón)."
      empty={data.length === 0}
      summary={`Anillo con ${data.length} canales: ${data.map((d) => `${d.name} ${d.share}%`).join(", ")}.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="orders" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={2} stroke={surface} strokeWidth={2}>
            {data.map((d, i) => (
              <Cell key={d.channel} fill={p.series[i % p.series.length]} />
            ))}
          </Pie>
          <Tooltip {...tooltipStyle(p)} formatter={(value, name) => [`${value} pedidos`, String(name)]} />
          <Legend {...legendProps(p)} />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
