import { AlertCircle, Inbox, RefreshCw } from "lucide-react";

export function LoadingView() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-live="polite">
      <span className="sr-only">Cargando el tablero…</span>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="exec-skeleton shimmer h-32" />
        ))}
      </div>
      <div className="exec-skeleton shimmer h-48" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="exec-skeleton shimmer h-72" />
        <div className="exec-skeleton shimmer h-72" />
      </div>
    </div>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="exec-card p-6 flex flex-col items-center gap-3 text-center">
      <AlertCircle size={28} aria-hidden="true" style={{ color: "var(--ex-bad)" }} />
      <p className="font-bold">No pudimos cargar el tablero</p>
      <p className="text-sm exec-muted break-words max-w-full">{message}</p>
      <button type="button" className="exec-chip" onClick={onRetry}>
        <RefreshCw size={14} aria-hidden="true" />
        Reintentar
      </button>
    </div>
  );
}

export function EmptyView() {
  return (
    <div className="exec-card p-8 flex flex-col items-center gap-2 text-center">
      <Inbox size={28} aria-hidden="true" className="exec-muted" />
      <p className="font-bold">Todavía no hay pedidos en este período</p>
      <p className="text-sm exec-muted">Probá con otro período o con todas las zonas.</p>
    </div>
  );
}
