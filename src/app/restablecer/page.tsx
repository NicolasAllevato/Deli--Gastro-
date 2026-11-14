"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { KeyRound, Loader2 } from "lucide-react";

const MIN_PASSWORD = 10;

/** Elegir contraseña nueva con el link de un solo uso (Better Auth, etapa 3). */
function RestablecerContent() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) return setError(`La contraseña necesita al menos ${MIN_PASSWORD} caracteres.`);
    if (password !== confirm) return setError("Las contraseñas no coinciden.");
    setBusy(true);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword: password, token }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) setDone(true);
    else setError("El link venció o ya se usó. Pedí uno nuevo.");
  };

  if (!token) {
    return <p className="text-sm text-gray-600">El link no es válido. <Link href="/recuperar" className="font-bold text-brand-orange">Pedí uno nuevo</Link>.</p>;
  }
  if (done) {
    return <p className="text-sm text-gray-600" role="status">Listo. <Link href="/login" className="font-bold text-brand-orange">Ingresá con tu contraseña nueva</Link>.</p>;
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <label htmlFor="new-pass" className="text-[11px] font-bold text-gray-500 uppercase tracking-widest ml-1">Contraseña nueva</label>
      <input id="new-pass" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-4 py-3 rounded-xl neumorphic-inset text-sm text-gray-700 outline-none focus:ring-2 focus:ring-brand-orange/40" />
      <label htmlFor="new-pass-2" className="text-[11px] font-bold text-gray-500 uppercase tracking-widest ml-1">Repetila</label>
      <input id="new-pass-2" type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full px-4 py-3 rounded-xl neumorphic-inset text-sm text-gray-700 outline-none focus:ring-2 focus:ring-brand-orange/40" />
      {error ? <p className="text-xs font-bold text-red-500" role="alert">{error}</p> : null}
      <button type="submit" disabled={busy} className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand-orange px-4 py-3 text-sm font-bold text-white btn-glow disabled:opacity-60">
        {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <KeyRound size={16} aria-hidden />}
        Guardar contraseña
      </button>
    </form>
  );
}

export default function RestablecerPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm neumorphic rounded-3xl p-6 space-y-4">
        <h1 className="text-xl font-bold text-gray-800">Nueva contraseña</h1>
        <Suspense fallback={null}>
          <RestablecerContent />
        </Suspense>
      </div>
    </main>
  );
}
