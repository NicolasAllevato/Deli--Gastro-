"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, Loader2 } from "lucide-react";

interface Props {
  intentId: string;
  total: string;
  status: string;
}

/** Marca el nodo cuando React ya lo hidrató: los tests esperan esta señal antes de hacer clic. */
function markHydrated(node: HTMLElement | null): void {
  if (node) node.dataset.hydrated = "true";
}

export default function DemoCheckout({ intentId, total, status }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolve = async (outcome: "approved" | "rejected") => {
    setError(null);
    setBusy(outcome);
    try {
      const res = await fetch(`/api/demo/payments/${intentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
      });
      if (!res.ok) throw new Error("No se pudo simular el pago.");
      router.push(`/cliente/pago/${intentId}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo simular el pago.");
      setBusy(null);
    }
  };

  return (
    <main
      ref={markHydrated}
      className="min-h-screen flex items-center justify-center px-4 bg-surface text-on-surface"
    >
      <div className="neumorphic rounded-3xl p-8 w-full max-w-sm text-center space-y-4 animate-pop-in">
        <div className="w-14 h-14 mx-auto rounded-full neumorphic-inset flex items-center justify-center text-brand-orange">
          <CreditCard size={26} aria-hidden />
        </div>
        <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Simulador de Mercado Pago</p>
        <h1 className="font-headline text-2xl font-black text-gray-800">{total}</h1>
        <p className="text-xs text-gray-500">Modo demo: elegí cómo termina el pago. No se cobra nada real.</p>

        {error && <p role="alert" className="text-xs font-bold text-red-600">{error}</p>}

        {status === "pending" ? (
          <div className="flex flex-col gap-2 pt-2">
            <button
              type="button"
              onClick={() => resolve("approved")}
              disabled={busy !== null}
              className="w-full py-3 rounded-full btn-glow text-white font-black text-sm disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy === "approved" && <Loader2 size={16} className="animate-spin" aria-hidden />} Aprobar pago
            </button>
            <button
              type="button"
              onClick={() => resolve("rejected")}
              disabled={busy !== null}
              className="w-full py-3 rounded-full neumorphic text-red-600 font-black text-sm disabled:opacity-50"
            >
              Rechazar pago
            </button>
          </div>
        ) : (
          <p className="text-sm font-bold text-gray-600">Este pago ya está {status}.</p>
        )}
      </div>
    </main>
  );
}
