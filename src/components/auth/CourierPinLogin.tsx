"use client";

import { useState } from "react";
import { Bike, Loader2 } from "lucide-react";

const PIN_LENGTH = 6;
/** PIN viejo de 4 dígitos: entra durante la transición (sin envío automático, con el botón). */
const LEGACY_PIN_LENGTH = 4;
const DEVICE_KEY = "courier-device-id";

/** Id aleatorio del dispositivo, para limitar intentos por dispositivo además de por IP. */
function deviceId(): string | null {
  try {
    let id = window.localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

const isSubmittable = (v: string) => v.length === PIN_LENGTH || v.length === LEGACY_PIN_LENGTH;

/** Ingreso del repartidor con el PIN de 6 dígitos que le asignó el local. */
export function CourierPinLogin() {
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (value: string) => {
    if (!isSubmittable(value) || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/courier-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(deviceId() ? { "x-device-id": deviceId() as string } : {}) },
        body: JSON.stringify({ pin: value }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; home?: string };
      if (!res.ok) throw new Error(json.error ?? "No pudimos verificar el PIN.");
      // Navegación completa: la sesión recién creada tiene que llegar al proxy (sin la caché del router).
      window.location.assign(json.home ?? "/repartidor");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No pudimos verificar el PIN.");
      setPin("");
      setLoading(false);
    }
  };

  const onChange = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, PIN_LENGTH);
    setPin(digits);
    if (digits.length === PIN_LENGTH) void submit(digits);
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); void submit(pin); }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <label htmlFor="courier-pin" className="text-[11px] font-bold text-gray-500 uppercase tracking-widest ml-1">
          PIN de repartidor
        </label>
        <input
          id="courier-pin"
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{4}|\d{6}"
          maxLength={PIN_LENGTH}
          value={pin}
          onChange={(e) => onChange(e.target.value)}
          disabled={loading}
          autoFocus
          placeholder="••••••"
          aria-describedby="courier-pin-help"
          className="w-full px-4 py-4 rounded-xl neumorphic-inset text-center text-3xl tracking-[0.6em] font-black text-gray-800 placeholder-gray-400 outline-none focus:ring-2 focus:ring-brand-orange/40 transition-all disabled:opacity-60"
        />
        <p id="courier-pin-help" className="text-xs text-gray-500 ml-1">
          Son 6 números. Te los da el local; si no los tenés, pedíselos. Si todavía tenés uno de 4, escribilo y tocá Entrar.
        </p>
      </div>

      {error && (
        <p role="alert" className="px-4 py-3 rounded-xl bg-red-50 border border-red-100 text-xs font-bold text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading || !isSubmittable(pin)}
        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl btn-glow text-white font-black text-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading
          ? <><Loader2 size={16} className="animate-spin" aria-hidden /> Verificando...</>
          : <><Bike size={16} aria-hidden /> Entrar a reparto</>}
      </button>
    </form>
  );
}
