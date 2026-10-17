"use client";

import Link from "next/link";
import { Cookie } from "lucide-react";
import { acceptAll, essentialOnly } from "@/lib/consent/consentCore";
import { useConsent } from "@/lib/consent/useConsent";

/**
 * Banner de consentimiento. Aparece hasta que la persona elige; la elección queda en la
 * cookie `opsyn_consent` y se puede cambiar en /cookies.
 */
export function CookieNotice() {
  const { consent, ready, save } = useConsent();
  if (!ready || consent) return null;

  return (
    <div role="region" aria-label="Preferencias de cookies" className="fixed inset-x-0 bottom-0 z-50 p-4 fade-up">
      <div className="max-w-3xl mx-auto glass-effect neumorphic rounded-2xl p-4 flex flex-col md:flex-row items-start md:items-center gap-3">
        <Cookie size={20} className="text-brand-orange shrink-0" aria-hidden />
        <p className="text-xs text-gray-600 flex-1">
          Usamos cookies esenciales para tu sesión y tu carrito. Con tu permiso, también recordamos tus
          preferencias (como el tema). No usamos cookies de publicidad.{" "}
          <Link href="/cookies" className="font-bold underline text-gray-800">Más información</Link>
        </p>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Link href="/cookies" className="neumorphic neumorphic-hover rounded-full px-4 py-2 text-xs font-bold text-gray-700">
            Configurar
          </Link>
          <button type="button" onClick={() => save(essentialOnly())} className="neumorphic neumorphic-hover rounded-full px-4 py-2 text-xs font-bold text-gray-700">
            Solo esenciales
          </button>
          <button type="button" onClick={() => save(acceptAll())} className="btn-glow text-white rounded-full px-4 py-2 text-xs font-bold">
            Aceptar todas
          </button>
        </div>
      </div>
    </div>
  );
}
