"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, RotateCcw } from "lucide-react";
import { isDemoMode } from "@/lib/demo/mode";

/** Cinta fija que avisa que es un entorno de ejemplo y permite restaurar los datos. */
export function DemoBanner() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!isDemoMode()) return null;

  const reset = async () => {
    if (!confirm("¿Restaurar los datos de ejemplo? Se pierden los cambios hechos en esta sesión.")) return;
    setBusy(true);
    try {
      await fetch("/api/demo/reset", { method: "POST" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="status"
      className="fixed bottom-0 left-0 z-[60] flex items-center gap-2 pl-3 pr-2 py-1 rounded-tr-xl bg-gray-900/85 text-white text-[11px] font-bold backdrop-blur"
    >
      <FlaskConical size={12} aria-hidden />
      Modo demo · nada se guarda
      <button
        type="button"
        onClick={reset}
        disabled={busy}
        aria-label="Reiniciar datos de ejemplo"
        className="ml-1 flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/15 hover:bg-white/25 transition-colors disabled:opacity-50"
      >
        <RotateCcw size={11} aria-hidden />
        Reiniciar
      </button>
    </div>
  );
}
