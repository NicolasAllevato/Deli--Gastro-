"use client";

import { useState, type KeyboardEvent } from "react";
import { Lock, Send } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { formatRemaining, windowRemainingMs } from "./conversation-utils";

interface ComposerProps {
  lastInboundAt: string | null;
  now: number;
  busy: boolean;
  onSend: (text: string) => Promise<boolean>;
}

const MAX_LENGTH = 1000;

/**
 * Caja de respuesta manual. Fuera de la ventana de 24 h Meta rechaza el texto libre (error 131047),
 * así que se bloquea acá y se manda a usar una plantilla aprobada.
 */
export function Composer({ lastInboundAt, now, busy, onSend }: ComposerProps) {
  const [text, setText] = useState("");
  const remaining = windowRemainingMs(lastInboundAt, now);

  if (remaining === 0) {
    return (
      <div className="flex items-start gap-2 rounded-xl neumorphic-inset p-3 text-xs text-gray-600">
        <Lock size={14} className="shrink-0 mt-0.5" aria-hidden />
        <p>
          Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp solo permite escribirle con una{" "}
          <Link href="/admin/plantillas" className="font-bold text-brand-orange underline">plantilla aprobada</Link>.
        </p>
      </div>
    );
  }

  const submit = async () => {
    if (!text.trim() || busy) return;
    if (await onSend(text)) setText("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-1">
      <div className="flex gap-2 items-end">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          maxLength={MAX_LENGTH}
          aria-label="Respuesta manual"
          placeholder="Escribir como el local (Enter envía, Shift+Enter salta de línea)"
          className="flex-1 min-w-0 resize-none px-4 py-3 rounded-xl neumorphic-inset text-sm text-gray-700 placeholder-gray-500 outline-none focus:ring-2 focus:ring-brand-orange/40"
        />
        <Button type="submit" size="sm" aria-label="Enviar respuesta" disabled={busy || !text.trim()} leftIcon={<Send size={14} aria-hidden />}>
          Enviar
        </Button>
      </div>
      <p className="text-[10px] text-gray-500 flex justify-between">
        <span>Ventana de 24 h: quedan {formatRemaining(remaining)}</span>
        <span>{text.length}/{MAX_LENGTH}</span>
      </p>
    </form>
  );
}
