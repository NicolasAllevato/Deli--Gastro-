"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, LogIn, Loader2 } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { isDemoMode } from "@/lib/demo/mode";
import { DemoAccessPanel } from "@/components/demo/DemoAccessPanel";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { Copyright } from "@/components/Copyright";
import { CourierPinLogin } from "@/components/auth/CourierPinLogin";

type LoginMode = "personal" | "repartidor";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Validar que redirectTo sea una ruta interna para evitar open redirect
  const raw = searchParams.get("redirectTo") ?? "/admin/ejecutivo";
  const redirectTo = raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("://")
    ? raw
    : "/admin/ejecutivo";

  // La app del repartidor abre /repartidor: si viene de ahí, arranca en el ingreso con PIN.
  const [mode, setMode] = useState<LoginMode>(redirectTo.startsWith("/repartidor") ? "repartidor" : "personal");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError("Email o contraseña incorrectos.");
      setLoading(false);
      return;
    }

    router.push(redirectTo);
    router.refresh();
  };

  const credentialsForm = (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Email */}
      <div className="space-y-1.5">
        <label htmlFor="login-email" className="text-[11px] font-bold text-gray-500 uppercase tracking-widest ml-1">
          Email
        </label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoComplete="email"
          placeholder="admin@deli-gastro.com"
          className="w-full px-4 py-3 rounded-xl neumorphic-inset text-sm text-gray-700 placeholder-gray-400 outline-none focus:ring-2 focus:ring-brand-orange/40 transition-all"
        />
      </div>

      {/* Password */}
      <div className="space-y-1.5">
        <label htmlFor="login-password" className="text-[11px] font-bold text-gray-500 uppercase tracking-widest ml-1">
          Contraseña
        </label>
        <div className="relative">
          <input
            id="login-password"
            type={showPass ? "text" : "password"}
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            placeholder="••••••••"
            className="w-full pl-4 pr-11 py-3 rounded-xl neumorphic-inset text-sm text-gray-700 placeholder-gray-400 outline-none focus:ring-2 focus:ring-brand-orange/40 transition-all"
          />
          <button
            type="button"
            onClick={() => setShowPass(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-600 transition-colors"
            aria-label={showPass ? "Ocultar contraseña" : "Mostrar contraseña"}
          >
            {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-100 text-xs font-bold text-red-600">
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl btn-glow text-white font-black text-sm mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading
          ? <><Loader2 size={16} className="animate-spin" /> Verificando...</>
          : <><LogIn size={16} /> Ingresar</>
        }
      </button>
    </form>
  );

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-5">
      <div className="fixed top-4 right-4 z-10">
        <ThemeToggle compact />
      </div>
      {/* Orb decorativo */}
      <div aria-hidden className="pointer-events-none fixed top-0 right-0 w-96 h-96 rounded-full bg-brand-orange/5 blur-3xl" />
      <div aria-hidden className="pointer-events-none fixed bottom-0 left-0 w-80 h-80 rounded-full bg-brand-orange/4 blur-3xl" />

      <div className="w-full max-w-sm fade-up">

        {/* Logo */}
        <div className="text-center mb-10">
          <h1 className="font-headline text-4xl font-black text-gray-900">
            Opsyn <span className="text-brand-orange">Dely</span>
          </h1>
          <p className="text-gray-500 text-sm mt-2">
            {mode === "repartidor" ? "Reparto" : "Panel de administración"}
          </p>
        </div>

        <div role="tablist" aria-label="Tipo de ingreso" className="grid grid-cols-2 gap-1 p-1 mb-4 rounded-2xl neumorphic-inset">
          {([["personal", "Personal del local"], ["repartidor", "Repartidor"]] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={`py-2.5 rounded-xl text-xs font-black transition-all ${
                mode === value ? "neumorphic text-brand-orange" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "repartidor" ? (
          <div className="neumorphic rounded-3xl p-6 sm:p-8 space-y-6">
            <div>
              <h2 className="font-headline font-black text-xl text-gray-800">Ingresá con tu PIN</h2>
              <p className="text-gray-500 text-xs mt-1">
                {isDemoMode() ? "Modo demostración: el PIN del repartidor de ejemplo es 1234." : "Solo para repartidores del local"}
              </p>
            </div>
            <CourierPinLogin />
          </div>
        ) : isDemoMode() ? (
          <div className="neumorphic rounded-3xl p-6 sm:p-8 space-y-6">
            <div>
              <h2 className="font-headline font-black text-xl text-gray-800">Modo demostración</h2>
              <p className="text-gray-500 text-xs mt-1">
                Elegí un rol para recorrer la plataforma con datos de ejemplo. No se guarda nada.
              </p>
            </div>
            <DemoAccessPanel />
            <div className="pt-2 border-t border-gray-200/60 space-y-4">
              <p className="text-xs text-gray-500">
                O con email y contraseña de una cuenta de ejemplo (contraseña <strong>demo1234</strong>).
                Las cuentas reales de Supabase no funcionan en la demo.
              </p>
              {credentialsForm}
            </div>
          </div>
        ) : (
        <div className="neumorphic rounded-3xl p-6 sm:p-8 space-y-6">
          <div>
            <h2 className="font-headline font-black text-xl text-gray-800">Iniciá sesión</h2>
            <p className="text-gray-500 text-xs mt-1">Solo para personal autorizado</p>
          </div>

          {credentialsForm}
        </div>
        )}

        <Copyright className="mt-6" />

      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
