"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErroresTab } from "./ErroresTab";
import { ESTADO_BADGE, ORIGEN_LABEL, type Accion, type ErrorAprendido } from "./aprendizaje-shared";

interface Sugerencia {
  id: string;
  estado: "pendiente" | "aprobada" | "rechazada";
  categoria: string;
  tema: string;
  contenido: string;
  evidencia: string;
  veces: number;
  origen?: "simulacion" | "conversacion";
}

type Tab = "sugerencias" | "errores";

const URL = "/api/admin/conocimiento/aprendizaje";

async function call<T>(method: string, body?: unknown): Promise<T> {
  const res = await fetch(URL, {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "No se pudo completar la operación.");
  return json;
}

/** Sugerencias del simulador y errores aprendidos: el admin decide; nada se activa solo. */
export function Aprendizaje({ onApproved }: { onApproved: () => void }) {
  const [tab, setTab] = useState<Tab>("sugerencias");
  const [data, setData] = useState<{ sugerencias: Sugerencia[]; errores: ErrorAprendido[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await call("GET"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function decide(tipo: "sugerencia" | "error", id: string, accion: Accion) {
    setBusy(true);
    setError(null);
    try {
      await call("PATCH", { tipo, id, accion });
      if (tipo === "sugerencia" && accion === "aprobar") onApproved();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la operación.");
    } finally {
      setBusy(false);
    }
  }

  const pendSug = data?.sugerencias.filter((s) => s.estado === "pendiente").length ?? 0;
  const pendErr = data?.errores.filter((e) => e.estado === "pendiente").length ?? 0;

  return (
    <section className="neumorphic rounded-2xl p-5 space-y-4" aria-label="Aprendizaje del agente">
      <div className="flex gap-2" role="tablist" aria-label="Aprendizaje">
        {([["sugerencias", `Sugerencias (${pendSug})`], ["errores", `Errores aprendidos (${pendErr})`]] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`px-3 py-2 rounded-xl text-xs font-bold ${tab === value ? "neumorphic-inset text-brand-orange" : "text-gray-600"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-500">
        {tab === "sugerencias"
          ? "Lo que propusieron el simulador y el análisis nocturno de conversaciones reales. Al aprobar, pasa a la base de conocimiento activa."
          : "Fallas que detectaron el simulador y el análisis nocturno de conversaciones reales. Al aprobar, la corrección se vuelve una lección que el agente recibe como «Errores a evitar» (hasta 20) y se repite como prueba en la próxima simulación."}
      </p>
      {error && <p role="alert" className="text-xs font-bold text-red-600">{error}</p>}
      {data === null && !error && <p className="text-sm text-gray-500">Cargando...</p>}

      {tab === "sugerencias" && data && (
        <ul className="space-y-2">
          {data.sugerencias.length === 0 && <li className="text-sm text-gray-500">Sin sugerencias. Corré el simulador: npm run simular:bot</li>}
          {data.sugerencias.map((s) => (
            <li key={s.id} className="neumorphic-inset rounded-xl p-3 space-y-1">
              <p className="text-xs text-gray-500">
                <span className={ESTADO_BADGE[s.estado]}>{s.estado}</span> · {ORIGEN_LABEL(s.origen)} · {s.categoria} · {s.veces} {s.veces === 1 ? "vez" : "veces"}
              </p>
              <p className="text-sm font-bold text-gray-800">{s.tema}</p>
              <p className="text-xs text-gray-600 whitespace-pre-wrap">{s.contenido}</p>
              {s.evidencia && <p className="text-xs text-gray-500 italic">Ej.: {s.evidencia}</p>}
              {s.estado === "pendiente" && (
                <div className="flex gap-2 pt-1">
                  <Button size="sm" disabled={busy} onClick={() => void decide("sugerencia", s.id, "aprobar")}>Aprobar</Button>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void decide("sugerencia", s.id, "rechazar")}>Rechazar</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {tab === "errores" && data && (
        <ErroresTab errores={data.errores} busy={busy} onDecide={(id, accion) => void decide("error", id, accion)} />
      )}
    </section>
  );
}
