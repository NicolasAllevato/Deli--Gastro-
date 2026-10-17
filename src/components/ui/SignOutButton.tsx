"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";
import { createClient } from "@/utils/supabase/client";

interface Props {
  /** Solo ícono (cabeceras angostas en móvil). El texto queda para lectores de pantalla. */
  compact?: boolean;
  className?: string;
}

/** Cierra la sesión (Supabase o demo) y vuelve al login. Igual en los tres portales. */
export function SignOutButton({ compact = false, className = "" }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    setBusy(true);
    try {
      await createClient().auth.signOut();
    } finally {
      router.push("/login");
      router.refresh();
    }
  };

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      aria-label={compact ? "Cerrar sesión" : undefined}
      title="Cerrar sesión"
      className={`inline-flex items-center gap-2 rounded-full neumorphic neumorphic-hover px-3 py-2 text-xs font-bold text-gray-600 hover:text-red-500 transition-colors disabled:opacity-60 ${className}`}
    >
      {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <LogOut size={16} aria-hidden />}
      {compact ? null : "Cerrar sesión"}
    </button>
  );
}
