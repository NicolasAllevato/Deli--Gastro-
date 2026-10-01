"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ImageIcon, Loader2, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { formatMoney, PAYMENT_METHODS } from "@/lib/orders";
import { RESTAURANT_LOCATION, SAMPLE_ADDRESSES, calcDeliveryFee, haversineKm } from "@/lib/restaurant";
import { buttonClasses } from "@/lib/buttonClasses";
import { cn } from "@/lib/cn";
import { useCart } from "../_components/CartProvider";

interface Props {
  clientAddress: string | null;
  costoPorKm: number;
  radioKm: number;
  paused: boolean;
}

export default function CheckoutClient({ clientAddress, costoPorKm, radioKm, paused }: Props) {
  const router = useRouter();
  const { lines, subtotal, setQty, clear } = useCart();

  // Si la dirección guardada del cliente coincide con una zona conocida, parte seleccionada.
  const initialAddress = Math.max(0, SAMPLE_ADDRESSES.findIndex((a) => a.address === clientAddress));
  const [addressIndex, setAddressIndex] = useState(initialAddress);
  const [payment, setPayment] = useState<(typeof PAYMENT_METHODS)[number]>("Tarjeta");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [placed, setPlaced] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const address = SAMPLE_ADDRESSES[addressIndex]!;
  const { distanceKm, fee } = useMemo(() => {
    const km = haversineKm(RESTAURANT_LOCATION, address);
    return { distanceKm: km, fee: calcDeliveryFee(km, costoPorKm) };
  }, [address, costoPorKm]);
  const outOfZone = distanceKm > radioKm;
  const total = subtotal + fee;

  const confirm = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/client/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: lines.map((l) => ({ productId: l.id, qty: l.qty })),
          address: { address: address.address, lat: address.lat, lng: address.lng },
          paymentMethod: payment,
          notes: notes.trim() || undefined,
        }),
      });
      const json = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !json.id) throw new Error(json.error ?? "No se pudo crear el pedido.");
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

      <ul className="space-y-3">
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
        <select
          id="address"
          value={addressIndex}
          onChange={(e) => setAddressIndex(Number(e.target.value))}
          className="w-full px-4 py-3 rounded-xl neumorphic-inset text-sm text-gray-700 outline-none focus:ring-2 focus:ring-brand-orange/40"
        >
          {SAMPLE_ADDRESSES.map((a, i) => (
            <option key={a.address} value={i}>
              {a.label} — {a.address}
            </option>
          ))}
        </select>
        <p className={cn("text-xs font-medium", outOfZone ? "text-red-600 font-bold" : "text-gray-500")}>
          {outOfZone
            ? `Esta dirección queda a ${distanceKm.toFixed(1)} km: fuera de la zona de entrega (${radioKm} km).`
            : `A ${distanceKm.toFixed(1)} km del local.`}
        </p>
      </section>

      <section className="neumorphic rounded-2xl p-5 space-y-3">
        <fieldset>
          <legend className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">Forma de pago</legend>
          <div className="grid grid-cols-3 gap-2">
            {PAYMENT_METHODS.map((method) => (
              <label
                key={method}
                className={cn(
                  "cursor-pointer text-center px-2 py-3 rounded-xl text-xs font-bold transition-all",
                  payment === method
                    ? "bg-brand-orange text-white shadow-[0_3px_8px_rgba(107,124,69,0.3)]"
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
        <div className="flex justify-between text-gray-600"><span>Envío</span><span>{formatMoney(fee)}</span></div>
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
        disabled={submitting || paused || outOfZone}
        className="w-full flex items-center justify-center gap-2 py-4 rounded-full btn-glow text-white font-black text-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? <><Loader2 size={16} className="animate-spin" aria-hidden /> Confirmando...</> : <>Confirmar pedido — {formatMoney(total)}</>}
      </button>
    </div>
  );
}
