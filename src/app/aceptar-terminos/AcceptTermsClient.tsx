"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, FileText, Loader2 } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { LEGAL_DOCUMENTS, safeRedirect, type LegalDocumentId, type LegalStatus } from "@/lib/legal/documents";
import { formatDateTimeAR } from "@/lib/time-ar";

type Phase = "loading" | "ready" | "error";

async function fetchStatus(): Promise<LegalStatus | "unauthorized" | "error"> {
  try {
    const res = await fetch("/api/legal/acceptances", { cache: "no-store" });
    if (res.status === 401) return "unauthorized";
    if (!res.ok) return "error";
    return (await res.json()) as LegalStatus;
  } catch {
    return "error";
  }
}

export function AcceptTermsClient() {
  const router = useRouter();
  const target = safeRedirect(useSearchParams().get("redirectTo"));
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState<LegalStatus | null>(null);
  const [busy, setBusy] = useState<LegalDocumentId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(
    (result: LegalStatus | "unauthorized" | "error") => {
      if (result === "unauthorized") router.replace(`/login?redirectTo=${encodeURIComponent(target)}`);
      else if (result === "error") setPhase("error");
      else {
        setStatus(result);
        setPhase("ready");
      }
    },
    [router, target],
  );

  useEffect(() => {
    fetchStatus().then(apply);
  }, [apply]);

  const load = () => {
    setPhase("loading");
    void fetchStatus().then(apply);
  };

  const accept = async (document: LegalDocumentId) => {
    setBusy(document);
    setError(null);
    try {
      const res = await fetch("/api/legal/acceptances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document }),
      });
      const body = (await res.json().catch(() => null)) as (LegalStatus & { error?: string }) | null;
      if (!res.ok || !body) throw new Error(body?.error ?? "No pudimos guardar tu aceptación.");
      setStatus(body);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No pudimos guardar tu aceptación.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-lg page-fade">
        <div className="flex items-center gap-3 mb-6">
          <div className="relative w-12 h-12 rounded-2xl overflow-hidden logo-glow shrink-0">
            <Image src="/brand/opsyn-dely-logo.jpg" alt={`Logo de ${BRAND.appName}`} fill sizes="48px" className="object-cover" />
          </div>
          <div>
            <h1 className="font-headline text-2xl font-black text-gray-800">Antes de empezar</h1>
            <p className="text-xs text-gray-500">Bienvenido a {BRAND.appName}</p>
          </div>
        </div>
        <p className="text-sm text-gray-600 leading-relaxed">
          Para usar la plataforma necesitamos que leas y aceptes estos dos documentos. Cada uno se acepta por
          separado y queda registrado con la fecha.
        </p>

        {phase === "loading" && <div className="mt-6 h-48 rounded-2xl shimmer" aria-hidden />}
        {phase === "error" && (
          <p className="mt-6 text-sm text-red-600" role="alert">
            No pudimos cargar tu estado. <button type="button" className="underline font-bold" onClick={load}>Reintentar</button>
          </p>
        )}

        {phase === "ready" && status && (
          <>
            <ul className="mt-6 flex flex-col gap-3">
              {LEGAL_DOCUMENTS.map((doc) => {
                const acceptedAt = status.accepted[doc.id];
                return (
                  <li key={doc.id} className="neumorphic rounded-2xl p-5">
                    <div className="flex items-start gap-3">
                      <FileText size={20} className="text-brand-orange shrink-0 mt-0.5" aria-hidden />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-black text-gray-800">{doc.title}</p>
                        <Link href={doc.href} target="_blank" className="inline-flex items-center gap-1 text-xs font-bold text-gray-500 hover:text-gray-800 mt-1">
                          Leer el documento <ExternalLink size={12} aria-hidden />
                        </Link>
                      </div>
                    </div>
                    {acceptedAt ? (
                      <p className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-green-700">
                        <CheckCircle2 size={16} aria-hidden /> Aceptado el {formatDateTimeAR(acceptedAt)}
                      </p>
                    ) : (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void accept(doc.id)}
                        className="mt-4 w-full btn-glow text-white rounded-full px-5 py-3 text-sm font-bold inline-flex items-center justify-center gap-2"
                      >
                        {busy === doc.id && <Loader2 size={16} className="animate-spin" aria-hidden />}
                        {doc.cta}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>

            {error && <p className="mt-4 text-sm text-red-600" role="alert">{error}</p>}

            <button
              type="button"
              disabled={!status.complete}
              // Navegación completa: el router del cliente puede tener en caché la redirección a esta
              // misma pantalla (de antes de aceptar) y no volver a preguntarle al servidor.
              onClick={() => window.location.assign(target)}
              className="mt-6 w-full neumorphic neumorphic-hover rounded-full px-5 py-3 text-sm font-black text-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {status.complete ? "Ingresar" : `Falta aceptar ${status.pending.length === 2 ? "los dos documentos" : "un documento"}`}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
