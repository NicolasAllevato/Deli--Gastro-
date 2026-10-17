import { Timer } from "lucide-react";
import { elapsedTone, formatElapsed, type ElapsedTone } from "@/lib/orders";

const TONE_CLASSES: Record<ElapsedTone, string> = {
  ok: "text-emerald-700 bg-emerald-50 border-emerald-100",
  warn: "text-yellow-700 bg-yellow-50 border-yellow-200",
  late: "text-red-600 bg-red-50 border-red-200",
};

const TONE_LABEL: Record<ElapsedTone, string> = {
  ok: "en tiempo",
  warn: "demorándose",
  late: "demorado",
};

interface Props {
  /** Cuándo entró el pedido al proceso. */
  startedAt: string;
  /** Si el pedido terminó, el contador se congela en este instante. */
  endedAt?: string | null;
  /** Reloj compartido del tablero (se actualiza cada segundo). */
  now: number;
}

/** Contador de cuánto lleva un pedido dentro del proceso; se congela al finalizar. */
export function OrderTimer({ startedAt, endedAt, now }: Props) {
  const end = endedAt ? new Date(endedAt).getTime() : now;
  const ms = Math.max(0, end - new Date(startedAt).getTime());
  const tone: ElapsedTone = endedAt ? "ok" : elapsedTone(ms);
  const text = formatElapsed(ms);

  return (
    <span
      role="timer"
      aria-label={`${endedAt ? "Duración total" : "Tiempo en el proceso"}: ${text}${endedAt ? "" : `, ${TONE_LABEL[tone]}`}`}
      className={`flex items-center gap-1 shrink-0 text-[11px] font-black tabular-nums px-2 py-1 rounded-full border ${
        endedAt ? "text-gray-600 bg-transparent border-gray-200" : TONE_CLASSES[tone]
      }`}
    >
      <Timer size={12} aria-hidden />
      <span suppressHydrationWarning>{text}</span>
    </span>
  );
}
