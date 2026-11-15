"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { formatDateAR } from "@/lib/time-ar";

interface PendingSale {
  id: string;
  status: string;
  created_at: string;
  total_cents: number;
  fudo_sale_id: number | null;
  fudo_sale_sync: string | null;
  fudo_sale_error: string | null;
}

const SYNC_LABEL: Record<string, string> = {
  pending: "Pendiente",
  partial: "Parcial: revisar en Fudo",
  sending: "Enviando",
};

/** Pedidos con la venta en Fudo pendiente de sincronizar, con botón de reintento (solo admin, D1). */
export function VentasPendientes() {
  const [rows, setRows] = useState<PendingSale[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/fudo-ventas", { cache: "no-store" });
      // 409: la app todavía usa Supabase; el panel no aplica.
      if (!res.ok) return setRows(res.status === 409 ? [] : null);
      const json = (await res.json()) as { pending?: PendingSale[] };
      setRows(json.pending ?? []);
    } catch {
      setRows(null);
    }
  }, []);

  useEffect(() => {
    // Carga inicial: el setState ocurre después del fetch (asíncrono), no en el cuerpo del efecto.
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const retry = async (orderId: string) => {
    setBusy(orderId);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/fudo-ventas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const json = (await res.json().catch(() => ({}))) as { result?: string; error?: string };
      setMessage(!res.ok ? (json.error ?? "No se pudo reintentar.") : json.error ? `Sigue pendiente: ${json.error}` : null);
    } finally {
      setBusy(null);
      await load();
    }
  };

  if (!rows || rows.length === 0) return null;

  return (
    <section aria-labelledby="ventas-pendientes-title" className="neumorphic rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-brand-orange" aria-hidden="true" />
        <h2 id="ventas-pendientes-title" className="font-headline text-lg font-black text-gray-800">
          Ventas pendientes de enviar a Fudo ({rows.length})
        </h2>
      </div>
      <p className="text-xs text-gray-500">
        El pedido sigue su curso en la app. Si las escrituras en Fudo están apagadas o Fudo no respondió, la venta queda acá para reintentar.
      </p>
      {message && <p role="status" className="badge-yellow text-xs font-bold px-3 py-2 rounded-lg">{message}</p>}
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.id} className="neumorphic-inset rounded-xl p-3 flex flex-wrap items-center gap-3 text-sm">
            <span className="font-bold text-gray-800">#{r.id.slice(0, 8)}</span>
            <span className="text-gray-500">{formatDateAR(new Date(r.created_at), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
            <span className="text-gray-600">{r.status}</span>
            <span className="badge-orange text-xs font-bold px-2 py-0.5 rounded-lg">
              {r.fudo_sale_sync ? (SYNC_LABEL[r.fudo_sale_sync] ?? r.fudo_sale_sync) : "Pago/cierre pendiente"}
            </span>
            {r.fudo_sale_error && <span className="text-xs text-gray-500 basis-full">{r.fudo_sale_error}</span>}
            <button
              type="button"
              onClick={() => void retry(r.id)}
              disabled={busy !== null}
              className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-xl neumorphic-hover text-xs font-bold text-gray-700 disabled:opacity-50"
            >
              {busy === r.id ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-4 h-4" aria-hidden="true" />}
              Reintentar
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
