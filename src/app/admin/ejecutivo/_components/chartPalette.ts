import type { ExecTheme } from "./useExecTheme";

export interface ChartPalette {
  axis: string;
  grid: string;
  text: string;
  tooltipBg: string;
  tooltipBorder: string;
  series: [string, string, string];
}

const LIGHT: ChartPalette = {
  axis: "#475569",
  grid: "#e3e8f0",
  text: "#0f172a",
  tooltipBg: "#ffffff",
  tooltipBorder: "#cbd5e1",
  series: ["#6d28d9", "#1d4ed8", "#b45309"],
};

const DARK: ChartPalette = {
  axis: "#b4c0d3",
  grid: "#26344d",
  text: "#f1f5f9",
  tooltipBg: "#151e30",
  tooltipBorder: "#33435f",
  series: ["#c4b5fd", "#93c5fd", "#fcd34d"],
};

export const chartPalette = (theme: ExecTheme): ChartPalette => (theme === "dark" ? DARK : LIGHT);

export function tooltipStyle(p: ChartPalette) {
  return {
    contentStyle: {
      background: p.tooltipBg,
      border: `1px solid ${p.tooltipBorder}`,
      borderRadius: 12,
      color: p.text,
      fontSize: 12,
    },
    itemStyle: { color: p.text },
    labelStyle: { color: p.text, fontWeight: 700 },
  };
}
