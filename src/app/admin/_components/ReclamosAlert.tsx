"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

export interface ReclamosResumen {
  abiertos: number;
  enCurso: number;
  vencidos: number;
}

const POLL_MS = 60_000;

/** Contadores de reclamos para el panel (badge del menú y aviso). Se refresca cada minuto. */
export function useReclamosResumen(): ReclamosResumen | null {
  const [data, setData] = useState<ReclamosResumen | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/admin/reclamos/resumen", { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<ReclamosResumen>) : null))
        .then((next) => {
          if (alive && next) setData(next);
        })
        .catch(() => {
          /* sin red: se reintenta en el próximo ciclo */
        });
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return data;
}

/** Aviso arriba del contenido: reclamos sin atender y los que pasaron 2 h con el local abierto. */
export function ReclamosAlert({ resumen }: { resumen: ReclamosResumen | null }) {
  if (!resumen || resumen.abiertos === 0) return null;
  const vencidos = resumen.vencidos > 0;
  return (
    <div
      role="status"
      className={`mx-3 mb-2 px-4 py-2.5 rounded-2xl neumorphic flex flex-wrap items-center gap-2 text-sm ${vencidos ? "text-red-600" : "text-gray-700"}`}
    >
      <AlertTriangle size={16} aria-hidden className={vencidos ? "text-red-600" : "text-brand-orange"} />
      <span className="font-bold">
        {resumen.abiertos === 1 ? "1 reclamo sin atender" : `${resumen.abiertos} reclamos sin atender`}
      </span>
      {vencidos && <span>· {resumen.vencidos} lleva{resumen.vencidos === 1 ? "" : "n"} más de 2 h abierto{resumen.vencidos === 1 ? "" : "s"}</span>}
      <Link href="/admin/reclamos?estado=abierto" className="ml-auto font-bold text-brand-orange hover:underline">
        Ver reclamos
      </Link>
    </div>
  );
}
