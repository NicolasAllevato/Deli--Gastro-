"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, Loader2, RotateCcw, XCircle } from "lucide-react";
import { formatMoney } from "@/lib/orders";
import { buttonClasses } from "@/lib/buttonClasses";
import { cn } from "@/lib/cn";

interface IntentView {
  id: string;
  status: "pending" | "approved" | "cancelled" | "expired" | "refunded";
  total: number;
  orderId: string | null;
  expiresAt: string;
  checkoutUrl: string | null;
}

const POLL_MS = 3_000;

/** Marca el nodo cuando React ya lo hidrató: los tests esperan esta señal antes de hacer clic. */
function markHydrated(node: HTMLElement | null): void {
  if (node) node.dataset.hydrated = "true";
}

/** Estado del pago: espera la acreditación y, cuando se aprueba, lleva al seguimiento del pedido ya creado. */
export default function PaymentStatus({ initial }: { initial: IntentView }) {
  const router = useRouter();
  const [intent, setIntent] = useState(initial);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (intent.status !== "pending") return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/client/payments/${intent.id}`, { cache: "no-store" });
        if (!res.ok || stopped) return;
        const next = (await res.json()) as IntentView;
        if (stopped) return;
        setIntent(next);
        if (next.status === "approved" && next.orderId) router.replace(`/cliente/pedidos/${next.orderId}`);
      } catch {
        /* sin red por un momento: se reintenta en el próximo ciclo */
      }
    };
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [intent.id, intent.status, router]);

  const cancel = async () => {
    setError(null);
    setCancelling(true);
    try {
      const res = await fetch(`/api/client/payments/${intent.id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "No se pudo cancelar el pago.");
      }
      setIntent({ ...intent, status: "cancelled", checkoutUrl: null });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo cancelar el pago.");
    } finally {
      setCancelling(false);
    }
  };

  const view = (() => {
    switch (intent.status) {
      case "pending":
        return { icon: <Loader2 size={30} className="animate-spin text-brand-orange" aria-hidden />, title: "Esperando tu pago", text: "En cuanto Mercado Pago lo acredite, tu pedido pasa a la cocina. Podés dejar esta pantalla abierta." };
      case "approved":
        return { icon: <CheckCircle2 size={30} className="text-green-600" aria-hidden />, title: "¡Pago aprobado!", text: "Estamos preparando el seguimiento de tu pedido..." };
      case "refunded":
        return { icon: <RotateCcw size={30} className="text-gray-500" aria-hidden />, title: "Pago devuelto", text: "Te devolvimos el pago. Si no lo ves reflejado todavía, puede demorar unos días según tu medio de pago." };
      case "expired":
        return { icon: <Clock size={30} className="text-yellow-600" aria-hidden />, title: "El pago venció", text: "Pasó el tiempo para pagar y el pedido no se creó. Armalo de nuevo cuando quieras." };
      default:
        return { icon: <XCircle size={30} className="text-red-500" aria-hidden />, title: "Pago cancelado", text: "No se cobró nada. Podés volver al menú y armar otro pedido." };
    }
  })();

  return (
    <div className="px-4 py-10 max-w-md mx-auto">
      <div
        ref={markHydrated}
        role="status"
        aria-live="polite"
        className="neumorphic rounded-3xl p-8 text-center space-y-4 animate-pop-in"
      >
        <div className="w-16 h-16 mx-auto rounded-full neumorphic-inset flex items-center justify-center">{view.icon}</div>
        <h2 className="font-headline text-xl font-black text-gray-800">{view.title}</h2>
        <p className="text-sm text-gray-500">{view.text}</p>
        <p className="font-headline font-black text-brand-orange text-lg">{formatMoney(intent.total)}</p>

        {error && <p role="alert" className="text-xs font-bold text-red-600">{error}</p>}

        {intent.status === "pending" && (
          <div className="flex flex-col gap-2 pt-2">
            {intent.checkoutUrl && (
              <a href={intent.checkoutUrl} className={cn("justify-center", buttonClasses("primary", "md"))}>
                Ir a pagar
              </a>
            )}
            <button
              type="button"
              onClick={cancel}
              disabled={cancelling}
              className="text-xs font-bold text-gray-500 hover:text-red-600 transition-colors disabled:opacity-50"
            >
              {cancelling ? "Cancelando..." : "Cancelar este pago"}
            </button>
          </div>
        )}

        {intent.status !== "pending" && intent.status !== "approved" && (
          <Link href="/cliente" className={cn("inline-flex", buttonClasses("primary", "md"))}>
            Volver al menú
          </Link>
        )}
      </div>
    </div>
  );
}
