import type { ReactNode } from "react";
import type { ChartPalette } from "./chartPalette";

/** Leyenda con texto del color del tema (Recharts lo pinta con el color de la serie por defecto). */
export function legendProps(p: ChartPalette) {
  return {
    wrapperStyle: { fontSize: 12, paddingTop: 4 },
    iconType: "circle" as const,
    formatter: (value: ReactNode) => <span style={{ color: p.text, fontWeight: 600 }}>{value}</span>,
  };
}
