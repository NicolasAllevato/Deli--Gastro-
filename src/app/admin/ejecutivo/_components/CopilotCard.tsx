"use client";

import { useState, type CSSProperties } from "react";
import { AlertOctagon, AlertTriangle, ArrowRight, ChevronDown, ChevronUp, Info, Sparkles } from "lucide-react";
import type { Insight, Severity } from "@/lib/reports/executive";

const SEVERITY: Record<Severity, { label: string; color: string; Icon: typeof Info }> = {
  critical: { label: "Crítico", color: "var(--ex-bad)", Icon: AlertOctagon },
  warning: { label: "Atención", color: "var(--ex-warn)", Icon: AlertTriangle },
  info: { label: "Info", color: "var(--ex-info)", Icon: Info },
};

const COLLAPSED_COUNT = 4;

export function CopilotCard({ insights }: { insights: Insight[] }) {
  const [expanded, setExpanded] = useState(false);
  const canCollapse = insights.length > COLLAPSED_COUNT;
  const shown = expanded || !canCollapse ? insights : insights.slice(0, COLLAPSED_COUNT);

  return (
    <section className="exec-copilot p-4 sm:p-5" aria-labelledby="copiloto-titulo">
      <h2 id="copiloto-titulo" className="flex items-center gap-2 font-headline font-black text-base">
        <Sparkles size={18} aria-hidden="true" style={{ color: "var(--ex-accent)" }} />
        Copiloto
        <span className="text-[10px] font-bold uppercase tracking-widest rounded-full px-2 py-0.5" style={{ background: "var(--ex-surface-2)", border: "1px solid var(--ex-border)" }}>
          IA
        </span>
      </h2>
      <p className="text-xs exec-muted mt-0.5">Lo que conviene mirar hoy, según tus metas.</p>
      <ul className="mt-3 flex flex-col gap-2">
        {shown.map((insight, i) => {
          const { label, color, Icon } = SEVERITY[insight.severity];
          return (
            <li key={`${i}-${insight.text}`} className="exec-insight px-3 py-2 min-w-0" style={{ "--sev": color } as CSSProperties}>
              <p className="flex items-start gap-2 text-[13px] font-bold leading-snug">
                <Icon size={16} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color }} />
                <span className="min-w-0 break-words">
                  <span style={{ color }}>{label}: </span>
                  {insight.text}
                </span>
              </p>
              <p className="flex items-start gap-2 text-xs exec-muted mt-1 leading-snug">
                <ArrowRight size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span className="min-w-0 break-words">{insight.action}</span>
              </p>
            </li>
          );
        })}
      </ul>
      {canCollapse && (
        <button type="button" className="exec-chip mt-3" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          {expanded ? "Ver menos" : `Ver las ${insights.length - COLLAPSED_COUNT} restantes`}
        </button>
      )}
    </section>
  );
}
