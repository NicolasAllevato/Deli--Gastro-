"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Gift, ImageIcon, Loader2, Minus, Plus, Search, ShoppingBag, Trash2, X } from "lucide-react";
import { formatMoney, PAYMENT_METHODS, REWARDS } from "@/lib/orders";
import { applyReward } from "@/lib/rewards";
import { SAMPLE_ADDRESSES } from "@/lib/restaurant";
import type { DeliveryQuote } from "@/lib/zones";
import { buttonClasses } from "@/lib/buttonClasses";
import { cn } from "@/lib/cn";
import { useCart } from "../_components/CartProvider";

interface Props {
  clientAddress: string | null;
  paused: boolean;
  /** Direcciones de ejemplo para probar sin buscar (solo modo demo). */
  showSamples: boolean;
  /** Saldo de puntos del cliente. */
  points: number;
  /** Saldo a favor disponible en pesos: paga parte del pedido (envío incluido) o todo. */
  credit: number;
  /** Nombre de la categoría de cada producto (id → nombre), para valuar el canje. */
  productCategories: Record<string, string>;
  /** El cobro con Mercado Pago está configurado: si no, la opción no se ofrece. */
  onlinePayments: boolean;
}

interface Place {
  label: string;
  lat: number;
  lng: number;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  return json.error ?? fallback;
}

export default function CheckoutClient({ clientAddress, paused, showSamples, points, credit, productCategories, onlinePayments }: Props) {
  const router = useRouter();
  const { lines, subtotal, setQty, clear, rewardId, setReward } = useCart();

  const [query, setQuery] = useState(clientAddress ?? "");
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [address, setAddress] = useState<Place | null>(null);
  const [quote, setQuote] = useState<DeliveryQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [payment, setPayment] = useState<(typeof PAYMENT_METHODS)[number]>("Tarjeta");
  const methods = PAYMENT_METHODS.filter((m) => onlinePayments || m !== "Mercado Pago");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [placed, setPlaced] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cada vez que cambia la dirección, el servidor calcula cobertura y envío.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuoting(true);
    fetch("/api/client/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: address.lat, lng: address.lng }),
    })
      .then((res) => (res.ok ? (res.json() as Promise<DeliveryQuote>) : null))
      .then((q) => { if (!cancelled) setQuote(q); })
      .catch(() => { if (!cancelled) setQuote(null); })
      .finally(() => { if (!cancelled) setQuoting(false); });
    return () => { cancelled = true; };
  }, [address]);

  const pickAddress = (place: Place) => {
    setQuote(null);
    setAddress(place);
  };

  const search = async () => {
    setSearchError(null);
    setSearching(true);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(query.trim())}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res, "No pudimos buscar la dirección."));
      const found = (await res.json()) as Place[];
      setResults(found);
      if (found.length === 0) setSearchError("No encontramos esa dirección. Probá con calle, altura y barrio.");
    } catch (e: unknown) {
      setResults([]);
      setSearchError(e instanceof Error ? e.message : "No pudimos buscar la dirección.");
    } finally {
      setSearching(false);
    }
  };

  const covered = quote?.covered === true ? quote : null;
  const fee = covered?.fee ?? 0;
  const minOrder = covered?.minOrder ?? 0;
  const belowMin = covered !== null && subtotal < minOrder;
  const outOfZone = quote?.covered === false;

  // Mismo cálculo que hace el servidor al confirmar; el servidor sigue siendo el que manda.
  const reward = REWARDS.find((r) => r.id === rewardId) ?? null;
  const rewardOutcome = !reward
    ? null
    : points < reward.puntosRequeridos
      ? ({ ok: false, message: "No te alcanzan los puntos para este canje." } as const)
      : applyReward(
          reward,
          lines.map((l) => ({ qty: l.qty, price: l.price, categoria: productCategories[l.id] ?? null })),
          subtotal,
        );
  const discount = rewardOutcome?.ok ? rewardOutcome.discount : 0;
  const rewardBlocked = rewardOutcome?.ok === false;
  const payable = subtotal - discount + fee;
  // Misma cuenta que el servidor: el saldo a favor cubre hasta el total, envío incluido.
  const creditApplied = Math.min(credit, Math.max(0, payable));
  const total = payable - creditApplied;
  // Con el saldo cubriendo todo no hay nada que pagar: no se abre Mercado Pago.
  const payOnline = payment === "Mercado Pago" && total > 0;
  const canOrder = address !== null && covered !== null && !belowMin && !quoting && !rewardBlocked;

  const confirm = async () => {
    if (!address) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/client/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: lines.map((l) => ({ productId: l.id, qty: l.qty })),
          address: { address: address.label, lat: address.lat, lng: address.lng },
          paymentMethod: payment,
          notes: notes.trim() || undefined,
          rewardId: reward?.id,
        }),
      });
      const json = (await res.json()) as { id?: string; paymentUrl?: string; intentId?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? "No se pudo crear el pedido.");

      // Mercado Pago: el pedido se crea cuando se acredita el pago. Se limpia el carrito y se va a pagar.
      if (json.paymentUrl) {
        setPlaced(true);
        clear();
        window.location.assign(json.paymentUrl);
        return;
      }

      if (!json.id) throw new Error("No se pudo crear el pedido.");
      setPlaced(true);
      clear();
      router.push(`/cliente/pedidos/${json.id}`);
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo crear el pedido.");
      setSubmitting(false);
    }
  };

  // Pedido enviado: se limpió el carrito y se está yendo al seguimiento.
  if (placed) {
    return (
      <div role="status" className="px-4 py-16 max-w-2xl mx-auto flex flex-col items-center gap-3 text-gray-500">
        <Loader2 size={28} className="animate-spin text-brand-orange" aria-hidden />
        <p className="font-bold text-sm">¡Pedido enviado! Abriendo el seguimiento...</p>
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="px-4 py-6 max-w-2xl mx-auto">
        <div className="neumorphic-inset rounded-2xl p-10 text-center">
          <div className="w-12 h-12 rounded-full neumorphic flex items-center justify-center mx-auto mb-4 text-gray-300">
            <ShoppingBag size={22} aria-hidden />
          </div>
          <p className="font-bold text-gray-500 text-sm">Tu carrito está vacío</p>
          {reward && (
            <p className="mt-2 text-xs text-gray-500">
              Elegiste &ldquo;{reward.nombre}&rdquo;: agregá productos del menú para usarlo.
            </p>
          )}
          <Link href="/cliente" className={cn("mt-5 inline-flex", buttonClasses("primary", "md"))}>
            Ver menú
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto pb-8 space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/cliente" aria-label="Volver al menú" className={buttonClasses("icon", "sm")}>
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h2 className="font-headline text-2xl font-black text-gray-800">Tu pedido</h2>
          <p className="text-gray-500 text-xs mt-0.5">Revisá y confirmá</p>
        </div>
      </div>

      {paused && (
        <p role="alert" className="px-4 py-3 rounded-2xl bg-yellow-50 border border-yellow-200 text-yellow-800 text-xs font-bold">
          El local pausó los pedidos por un rato. Podés dejar el carrito armado e intentar más tarde.
        </p>
      )}

      {reward && rewardOutcome && (
        <section
          aria-label="Canje de puntos"
          className={cn(
            "rounded-2xl p-4 flex items-start gap-3 border animate-pop-in",
            rewardOutcome.ok ? "badge-green border-transparent" : "bg-yellow-50 border-yellow-200 text-yellow-800",
          )}
        >
          <Gift size={18} className="shrink-0 mt-0.5" aria-hidden />
          <div className="flex-1 min-w-0 text-xs">
            <p className="font-black text-sm">{reward.nombre}</p>
            <p className="mt-0.5 font-medium">
              {rewardOutcome.ok
                ? `Descuenta ${formatMoney(rewardOutcome.discount)}. Se usan ${reward.puntosRequeridos} de tus ${points} puntos al confirmar el pedido.`
                : rewardOutcome.message}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setReward(null)}
            aria-label={`Quitar el canje ${reward.nombre}`}
            className="w-7 h-7 rounded-full neumorphic flex items-center justify-center text-gray-600 shrink-0"
          >
            <X size={14} aria-hidden />
          </button>
        </section>
      )}

      <ul className="space-y-3 stagger">
        {lines.map((line) => (
          <li key={line.id} className="neumorphic rounded-2xl p-3 flex items-center gap-3">
            <div className="w-16 h-16 rounded-xl neumorphic-inset overflow-hidden relative shrink-0 flex items-center justify-center">
              {line.image_url ? (
                <Image src={line.image_url} alt="" fill sizes="64px" className="object-cover" />
              ) : (
                <ImageIcon size={20} className="text-gray-300" aria-hidden />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm text-gray-800 truncate">{line.name}</p>
              <p className="text-xs text-brand-orange font-black mt-0.5">{formatMoney(line.price * line.qty)}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQty(line.id, line.qty - 1)}
                aria-label={`Quitar una unidad de ${line.name}`}
                className="w-8 h-8 rounded-full neumorphic neumorphic-hover flex items-center justify-center text-gray-600"
              >
                {line.qty === 1 ? <Trash2 size={14} aria-hidden /> : <Minus size={14} aria-hidden />}
              </button>
              <span className="w-5 text-center text-sm font-black text-gray-800">{line.qty}</span>
              <button
                type="button"
                onClick={() => setQty(line.id, line.qty + 1)}
                aria-label={`Agregar otra unidad de ${line.name}`}
                className="w-8 h-8 rounded-full bg-brand-orange text-white flex items-center justify-center"
              >
                <Plus size={14} aria-hidden />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <section className="neumorphic rounded-2xl p-5 space-y-3">
        <label htmlFor="address" className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest">
          Dirección de entrega
        </label>
        <form
          onSubmit={(e) => { e.preventDefault(); void search(); }}
          className="flex gap-2"
        >
          <input
            id="address"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={200}
            placeholder="Calle y altura, barrio"
            className="flex-1 min-w-0 px-4 py-3 rounded-xl neumorphic-inset text-sm text-gray-700 placeholder-gray-500 outline-none focus:ring-2 focus:ring-brand-orange/40"
          />
          <button
            type="submit"
            disabled={searching || query.trim().length < 5}
            aria-label="Buscar dirección"
            className="px-4 rounded-xl neumorphic text-brand-orange font-bold text-sm flex items-center gap-1.5 disabled:opacity-50"
          >
            {searching ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Search size={16} aria-hidden />}
            Buscar
          </button>
        </form>

        {searchError && <p role="alert" className="text-xs font-bold text-red-600">{searchError}</p>}

        {(results.length > 0 || showSamples) && (
          <ul className="space-y-1.5" aria-label="Direcciones encontradas">
            {[...results, ...(showSamples ? SAMPLE_ADDRESSES.map((a) => ({ label: a.address, lat: a.lat, lng: a.lng })) : [])].map((place) => (
              <li key={`${place.lat},${place.lng},${place.label}`}>
                <button
                  type="button"
                  onClick={() => pickAddress(place)}
                  aria-pressed={address?.lat === place.lat && address?.lng === place.lng}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-xl text-xs",
                    address?.lat === place.lat && address?.lng === place.lng
                      ? "bg-brand-orange text-white font-bold"
                      : "neumorphic-inset text-gray-600",
                  )}
                >
                  {place.label}
                </button>
              </li>
            ))}
          </ul>
        )}

        {address && (
          <p
            role="status"
            className={cn("text-xs font-medium", outOfZone || belowMin ? "text-red-600 font-bold" : "text-gray-500")}
          >
            {quoting && "Calculando el envío..."}
            {!quoting && quote?.covered === false && quote.reason}
            {!quoting && belowMin && `El pedido mínimo para tu zona es ${formatMoney(minOrder)}.`}
            {!quoting && covered && !belowMin && `Entregamos en tu zona${covered.zone ? ` (${covered.zone})` : ""}.`}
            {!quoting && covered?.freeZoneAvailable && covered.fee > 0 && ` Tu dirección está fuera de la zona de envío gratis: tiene un recargo de envío de ${formatMoney(covered.fee)}.`}
            {!quoting && quote === null && "No pudimos calcular el envío. Probá de nuevo."}
          </p>
        )}
      </section>

      <section className="neumorphic rounded-2xl p-5 space-y-3">
        <fieldset>
          <legend className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">Forma de pago</legend>
          <div className="grid grid-cols-3 gap-2">
            {methods.map((method) => (
              <label
                key={method}
                className={cn(
                  "cursor-pointer text-center px-2 py-3 rounded-xl text-xs font-bold transition-all",
                  payment === method
                    ? "bg-brand-orange text-white shadow-[0_3px_8px_rgba(124,58,237,0.3)]"
                    : "neumorphic-inset text-gray-600",
                )}
              >
                <input
                  type="radio"
                  name="payment"
                  value={method}
                  checked={payment === method}
                  onChange={() => setPayment(method)}
                  className="sr-only"
                />
                {method}
              </label>
            ))}
          </div>
        </fieldset>

        {payOnline && (
          <p role="note" className="text-xs text-gray-500">
            Vas a pagar en Mercado Pago. Tu pedido se confirma y pasa a la cocina cuando se acredita el pago.
          </p>
        )}

        <div>
          <label htmlFor="notes" className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">
            Aclaraciones (opcional)
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={300}
            rows={2}
            placeholder="Ej. Sin cebolla, tocar timbre 3B"
            className="w-full px-4 py-3 rounded-xl neumorphic-inset text-sm text-gray-700 placeholder-gray-500 outline-none focus:ring-2 focus:ring-brand-orange/40 resize-none"
          />
        </div>
      </section>

      <section className="neumorphic rounded-2xl p-5 space-y-2 text-sm">
        <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{formatMoney(subtotal)}</span></div>
        {discount > 0 && reward && (
          <div className="flex justify-between text-green-700 font-bold">
            <span>Canje: {reward.nombre}</span><span>-{formatMoney(discount)}</span>
          </div>
        )}
        <div className="flex justify-between text-gray-600"><span>Envío</span><span>{formatMoney(fee)}</span></div>
        {creditApplied > 0 && (
          <div className="flex justify-between text-green-700 font-bold">
            <span>Saldo a favor aplicado</span><span>-{formatMoney(creditApplied)}</span>
          </div>
        )}
        <div className="flex justify-between pt-3 border-t border-gray-200/60 font-headline font-black text-base text-gray-800">
          <span>Total</span><span className="text-brand-orange">{formatMoney(total)}</span>
        </div>
      </section>

      {error && (
        <p role="alert" className="text-xs font-bold text-red-600 px-3 py-2 rounded-lg bg-red-50 border border-red-100">{error}</p>
      )}

      <button
        type="button"
        onClick={confirm}
        disabled={submitting || paused || !canOrder}
        className="w-full flex items-center justify-center gap-2 py-4 rounded-full btn-glow text-white font-black text-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? <><Loader2 size={16} className="animate-spin" aria-hidden /> {payOnline ? "Abriendo el pago..." : "Confirmando..."}</> : <>{payOnline ? "Pagar con Mercado Pago" : "Confirmar pedido"} — {formatMoney(total)}</>}
      </button>
    </div>
  );
}
