"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, Check, CheckCheck, CircleAlert, Mic } from "lucide-react";
import { FormattedText } from "./FormattedText";
import { dayLabel, groupByDay, type ThreadMessage } from "./conversation-utils";

/** Distancia al fondo (px) dentro de la cual el hilo sigue pegado a los mensajes nuevos. */
const STICK_THRESHOLD_PX = 80;

function StatusIcon({ status }: { status: string | null }) {
  if (status === "read") return <CheckCheck size={12} className="text-sky-300" aria-label="Leído" />;
  if (status === "delivered") return <CheckCheck size={12} aria-label="Entregado" />;
  if (status === "sent") return <Check size={12} aria-label="Enviado" />;
  if (status === "failed") return <CircleAlert size={12} className="text-red-200" aria-label="No se pudo enviar" />;
  return null;
}

function Bubble({ m }: { m: ThreadMessage }) {
  const out = m.direction === "out";
  const time = new Date(m.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className={`max-w-[85%] ${out ? "ml-auto" : ""}`}>
      <div className={`text-sm px-3 py-2 rounded-xl whitespace-pre-wrap break-words ${out ? "bg-brand-orange text-white rounded-br-sm" : "neumorphic text-gray-700 rounded-bl-sm"}`}>
        {m.type === "audio" && (
          <span className="flex items-center gap-1 text-[11px] opacity-80 mb-0.5"><Mic size={12} aria-hidden /> Audio{m.body ? " (transcripción)" : ""}</span>
        )}
        {m.body ? <FormattedText text={m.body} /> : m.type === "audio" ? "Audio sin transcribir" : "Mensaje no soportado"}
        <span className={`flex items-center justify-end gap-1 text-[10px] mt-1 ${out ? "text-white/80" : "text-gray-500"}`}>
          {time}
          {out && <StatusIcon status={m.status} />}
        </span>
      </div>
    </div>
  );
}

interface MessageThreadProps {
  conversationId: string;
  messages: ThreadMessage[];
  now: number;
}

/** Hilo con separadores por día y scroll pegado al final (idea del ChatThread de OpenWA, MIT). */
export function MessageThread({ conversationId, messages, now }: MessageThreadProps) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [showJump, setShowJump] = useState(false);

  // Al cambiar de conversación se arranca abajo de todo.
  useEffect(() => {
    stick.current = true;
  }, [conversationId]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, conversationId]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
    stick.current = near;
    setShowJump(!near);
  };

  const jump = () => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    stick.current = true;
    setShowJump(false);
  };

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={ref} onScroll={onScroll} className="h-full max-h-[460px] neumorphic-inset rounded-xl p-3 space-y-2 overflow-y-auto" role="log" aria-live="polite">
        {messages.length === 0 && <p className="text-center text-xs text-gray-500 py-6">Sin mensajes todavía.</p>}
        {groupByDay(messages).map((g) => (
          <section key={g.day} aria-label={dayLabel(g.day, now)} className="space-y-2">
            <p className="text-center">
              <span className="inline-block px-2 py-0.5 rounded-full neumorphic text-[10px] font-bold text-gray-500 first-letter:uppercase">{dayLabel(g.day, now)}</span>
            </p>
            {g.messages.map((m) => <Bubble key={m.id} m={m} />)}
          </section>
        ))}
      </div>
      {showJump && (
        <button type="button" onClick={jump} aria-label="Ir al último mensaje" className="absolute bottom-3 right-3 p-2 rounded-full neumorphic text-gray-600">
          <ArrowDown size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}
