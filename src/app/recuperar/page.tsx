"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Mail } from "lucide-react";

/**
 * "Olvidé mi contraseña" (Better Auth, etapa 3). Siempre muestra el mismo mensaje, exista o no
 * la cuenta, para no revelar qué emails están registrados.
 */
export default function RecuperarPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await fetch("/api/auth/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, redirectTo: "/restablecer" }),
    }).catch(() => null);
    setBusy(false);
    setSent(true);
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm neumorphic rounded-3xl p-6 space-y-4">
        <h1 className="text-xl font-bold text-gray-800">Recuperar contraseña</h1>
        {sent ? (
          <p className="text-sm text-gray-600" role="status">
            Si el email está registrado, te mandamos un link para elegir una contraseña nueva. Vence en 15 minutos.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <label htmlFor="rec-email" className="text-[11px] font-bold text-gray-500 uppercase tracking-widest ml-1">
              Email
            </label>
            <input
              id="rec-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl neumorphic-inset text-sm text-gray-700 outline-none focus:ring-2 focus:ring-brand-orange/40"
            />
            <button type="submit" disabled={busy} className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand-orange px-4 py-3 text-sm font-bold text-white btn-glow disabled:opacity-60">
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Mail size={16} aria-hidden />}
              Enviar link
            </button>
          </form>
        )}
        <Link href="/login" className="block text-center text-xs font-bold text-gray-500 hover:text-brand-orange">
          Volver al ingreso
        </Link>
      </div>
    </main>
  );
}
