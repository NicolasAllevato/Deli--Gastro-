import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string;
  empty?: boolean;
  /** Descripción textual del gráfico para lectores de pantalla. */
  summary: string;
  children: ReactNode;
}

export function ChartCard({ title, subtitle, empty, summary, children }: Props) {
  return (
    <section className="exec-card p-4 sm:p-5 flex flex-col gap-3">
      <div>
        <h2 className="font-headline font-black text-base">{title}</h2>
        {subtitle && <p className="text-xs exec-muted mt-0.5">{subtitle}</p>}
      </div>
      {empty ? (
        <p className="text-sm exec-muted py-10 text-center">Sin datos para este período.</p>
      ) : (
        <div role="img" aria-label={summary} className="h-64 w-full min-w-0">
          {children}
        </div>
      )}
    </section>
  );
}
