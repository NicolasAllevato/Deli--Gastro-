"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  rewardId: string;
  rewardName: string;
}

export function RedeemButton({ rewardId, rewardName }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redeem = async () => {
    if (!confirm(`¿Canjear "${rewardName}"? Se descuentan los puntos de tu saldo.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/client/rewards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rewardId }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "No se pudo canjear.");
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo canjear.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={redeem}
        disabled={busy}
        aria-label={`Canjear: ${rewardName}`}
        className="px-3 py-1 rounded-full bg-brand-orange text-white text-xs font-black shadow-[0_4px_12px_rgba(124,58,237,0.3)] hover:scale-105 transition-transform disabled:opacity-50"
      >
        {busy ? "Canjeando..." : "Canjear"}
      </button>
      {error && <span role="alert" className="text-[10px] font-bold text-red-600">{error}</span>}
    </>
  );
}
