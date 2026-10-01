"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bike, Loader2, ShieldAlert, UserCheck, type LucideIcon } from "lucide-react";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/lib/demo/users";

const ROLE_ICON: Record<string, LucideIcon> = {
  admin: ShieldAlert,
  cliente: UserCheck,
  repartidor: Bike,
};

const ROLE_HINT: Record<string, string> = {
  admin: "Tablero, mapa, productos y configuración",
  cliente: "Menú, carrito, seguimiento y puntos",
  repartidor: "Entregas asignadas y confirmación",
};

/** Acceso de un clic a cada portal en modo demo (sin contraseña que tipear). */
export function DemoAccessPanel() {
  const router = useRouter();
  const [loadingRole, setLoadingRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enter = async (email: string, role: string) => {
    setError(null);
    setLoadingRole(role);
    try {
      const res = await fetch("/api/demo/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: DEMO_PASSWORD }),
      });
      const json = (await res.json()) as { home?: string };
      if (!res.ok || !json.home) throw new Error("login");
      router.push(json.home);
      router.refresh();
    } catch {
      setError("No se pudo iniciar la sesión de ejemplo.");
      setLoadingRole(null);
    }
  };

  return (
    <div className="space-y-3">
      {DEMO_ACCOUNTS.map((account) => {
        const Icon = ROLE_ICON[account.role] ?? UserCheck;
        const busy = loadingRole === account.role;
        return (
          <button
            key={account.role}
            type="button"
            onClick={() => enter(account.email, account.role)}
            disabled={loadingRole !== null}
            className="w-full flex items-center gap-4 p-4 rounded-2xl neumorphic neumorphic-hover text-left transition-all disabled:opacity-60"
          >
            <span className="w-11 h-11 rounded-xl neumorphic-inset flex items-center justify-center text-brand-orange shrink-0">
              {busy ? <Loader2 size={20} className="animate-spin" /> : <Icon size={20} />}
            </span>
            <span className="min-w-0">
              <span className="block font-headline font-black text-sm text-gray-800">
                Entrar como {account.label}
              </span>
              <span className="block text-xs text-gray-500 mt-0.5">{ROLE_HINT[account.role]}</span>
            </span>
          </button>
        );
      })}
      {error && (
        <p role="alert" className="text-xs font-bold text-red-600 px-3 py-2 rounded-lg bg-red-50 border border-red-100">
          {error}
        </p>
      )}
    </div>
  );
}
