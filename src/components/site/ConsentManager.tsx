"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { CONSENT_VERSION, acceptAll, essentialOnly, type Consent } from "@/lib/consent/consentCore";
import { useConsent } from "@/lib/consent/useConsent";
import { formatDateAR } from "@/lib/time-ar";

interface Category {
  key: "essential" | "preferences" | "analytics";
  title: string;
  text: string;
}

const CATEGORIES: readonly Category[] = [
  { key: "essential", title: "Esenciales", text: "Sesión iniciada, seguridad y carrito. Sin ellas la app no funciona, por eso están siempre activas." },
  { key: "preferences", title: "Preferencias", text: "Recordar tu tema claro u oscuro entre visitas. Si las rechazás, el tema vale solo para esta pestaña." },
  { key: "analytics", title: "Analítica", text: "Medir de forma agregada cómo se usa la app. Hoy no hay ninguna herramienta activa: si la sumamos, solo funcionará con este permiso." },
];

/** Panel funcional de /cookies: muestra la elección actual y permite cambiarla. */
export function ConsentManager() {
  const { consent, ready, save, clear } = useConsent();
  const [draft, setDraft] = useState<{ preferences: boolean; analytics: boolean } | null>(null);
  const [saved, setSaved] = useState(false);

  if (!ready) return <div className="h-40 rounded-2xl shimmer" aria-hidden />;

  const current = draft ?? { preferences: consent?.preferences ?? false, analytics: consent?.analytics ?? false };
  const toggle = (key: "preferences" | "analytics") => {
    setSaved(false);
    setDraft({ ...current, [key]: !current[key] });
  };
  const commit = (c: Consent) => {
    save(c);
    setDraft(null);
    setSaved(true);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-gray-500" aria-live="polite">
        {consent
          ? `Tu elección actual se guardó el ${formatDateAR(consent.decidedAt)}.`
          : "Todavía no elegiste. Mientras tanto solo usamos las esenciales."}
      </p>

      <ul className="flex flex-col gap-3">
        {CATEGORIES.map((cat) => {
          const fixed = cat.key === "essential";
          const on = fixed ? true : current[cat.key as "preferences" | "analytics"];
          return (
            <li key={cat.key} className="neumorphic-inset rounded-2xl p-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-black text-gray-800">{cat.title}</p>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">{cat.text}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={`${cat.title}: ${on ? "activadas" : "desactivadas"}`}
                disabled={fixed}
                onClick={() => !fixed && toggle(cat.key as "preferences" | "analytics")}
                className={`relative shrink-0 w-12 h-7 rounded-full transition-colors ${on ? "bg-brand-olive" : "bg-[#e2e8f0]"} ${fixed ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? "left-6" : "left-1"}`} />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => commit({ ...current, version: CONSENT_VERSION, decidedAt: new Date().toISOString() })}
          className="btn-glow text-white rounded-full px-5 py-2.5 text-xs font-bold"
        >
          Guardar elección
        </button>
        <button type="button" onClick={() => commit(acceptAll())} className="neumorphic neumorphic-hover rounded-full px-5 py-2.5 text-xs font-bold text-gray-700">
          Aceptar todas
        </button>
        <button type="button" onClick={() => commit(essentialOnly())} className="neumorphic neumorphic-hover rounded-full px-5 py-2.5 text-xs font-bold text-gray-700">
          Solo esenciales
        </button>
        {consent && (
          <button
            type="button"
            onClick={() => { clear(); setDraft(null); setSaved(false); }}
            className="rounded-full px-5 py-2.5 text-xs font-bold text-gray-500 hover:text-gray-800"
          >
            Borrar mi elección
          </button>
        )}
      </div>

      {saved && (
        <p className="inline-flex items-center gap-2 text-xs font-bold text-green-700" role="status">
          <CheckCircle2 size={16} aria-hidden /> Elección guardada.
        </p>
      )}
    </div>
  );
}
