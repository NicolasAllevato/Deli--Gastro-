"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { formatDateTimeAR } from "@/lib/time-ar";

interface Reclamo {
  id: string;
  client_phone: string;
  client_name: string | null;
  motivo: string;
  estado: "abierto" | "resuelto";
  created_at: string;
}

const URL = "/api/admin/conocimiento/reclamos";

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

const fecha = (iso: string): string => formatDateTimeAR(iso, { dateStyle: "short", timeStyle: "short" });

/** Reclamos que el bot registró fuera de horario: el local contacta al cliente y lo marca resuelto. */
export function Reclamos() {
  const [items, setItems] = useState<Reclamo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await call<{ reclamos: Reclamo[] }>("GET")).reclamos);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function cambiar(id: string, estado: Reclamo["estado"]) {
    setBusy(true);
    setError(null);
    try {
      await call("PATCH", { id, estado });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la operación.");
    } finally {
      setBusy(false);
    }
  }

  const abiertos = items?.filter((r) => r.estado === "abierto").length ?? 0;

  return (
    <section className="neumorphic rounded-2xl p-5 space-y-3" aria-label="Reclamos fuera de horario">
      <h2 className="text-sm font-bold text-gray-800">Reclamos fuera de horario ({abiertos} abiertos)</h2>
      <p className="text-xs text-gray-500">
        Cuando el local está cerrado el bot no deriva a una persona: registra el reclamo acá y le avisa al cliente que lo contactan al abrir.
      </p>
      {error && <p role="alert" className="text-xs font-bold text-red-600">{error}</p>}
      {items === null && !error && <p className="text-sm text-gray-500">Cargando...</p>}
      {items && (
        <ul className="space-y-2">
          {items.length === 0 && <li className="text-sm text-gray-500">Sin reclamos registrados.</li>}
          {items.map((r) => (
            <li key={r.id} className="neumorphic-inset rounded-xl p-3 space-y-1">
              <p className="text-xs text-gray-500">
                <span className={r.estado === "abierto" ? "badge-yellow" : "badge-green"}>{r.estado}</span> · {fecha(r.created_at)} ·{" "}
                {r.client_name ?? "Sin nombre"} · {r.client_phone}
              </p>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{r.motivo}</p>
              <div className="pt-1">
                {r.estado === "abierto" ? (
                  <Button size="sm" disabled={busy} onClick={() => void cambiar(r.id, "resuelto")}>Marcar resuelto</Button>
                ) : (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void cambiar(r.id, "abierto")}>Reabrir</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
