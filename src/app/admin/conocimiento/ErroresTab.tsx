"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { groupErrores, oneLine } from "@/lib/kb/errores-view";
import { ESTADO_BADGE, ORIGEN_LABEL, type Accion, type ErrorAprendido } from "./aprendizaje-shared";

const TIPO_LABEL: Record<string, string> = {
  precio_inventado: "Inventó un precio",
  no_derivo: "No derivó a una persona",
  no_entendio: "No entendió",
  tono_frio: "Tono frío",
  no_resolvio: "No resolvió",
  otro: "Otro",
};

const plural = (n: number) => (n === 1 ? "vez" : "veces");

/** Línea de contexto: estado, origen, tipo, escenario, veces y última prueba. */
function Meta({ e }: { e: ErrorAprendido }) {
  return (
    <p className="text-xs text-gray-500">
      <span className={ESTADO_BADGE[e.estado]}>{e.estado}</span> · {ORIGEN_LABEL(e.origen)} · {TIPO_LABEL[e.tipo] ?? e.tipo} · {e.escenario} · {e.veces} {plural(e.veces)}
      {e.ultima_prueba && ` · última prueba: ${e.ultima_prueba === "ok" ? "ya no falla" : "sigue fallando"}`}
    </p>
  );
}

/** Mensaje del cliente, respuesta mala, motivo y corrección completos. */
function Detalle({ e }: { e: ErrorAprendido }) {
  return (
    <div className="space-y-1">
      <Meta e={e} />
      <p className="text-xs text-gray-700"><b>Cliente:</b> {e.mensaje_cliente}</p>
      {e.respuesta_mala && <p className="text-xs text-gray-700"><b>Respondió:</b> {e.respuesta_mala}</p>}
      <p className="text-xs text-gray-600"><b>Motivo:</b> {e.motivo}</p>
      <p className="text-sm font-bold text-gray-800">Corrección: {e.correccion}</p>
    </div>
  );
}

interface Props {
  errores: readonly ErrorAprendido[];
  busy: boolean;
  onDecide: (id: string, accion: Accion) => void;
}

/** Fila plegable: una línea (escenario + corrección cortada) y, al abrirla, el detalle con sus botones. */
function Fila({ e, children }: { e: ErrorAprendido; children: ReactNode }) {
  return (
    <details className="group neumorphic-inset rounded-xl">
      <summary className="flex cursor-pointer list-none items-center gap-2 p-3 text-xs [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} aria-hidden className="shrink-0 text-gray-500 transition-transform group-open:rotate-90" />
        <span className="shrink-0 font-bold text-gray-700">{e.escenario}</span>
        <span className="min-w-0 truncate text-gray-600">{oneLine(e.correccion, 100)}</span>
      </summary>
      <div className="space-y-2 px-3 pb-3">{children}</div>
    </details>
  );
}

/** Errores aprendidos: pendientes completos, aprobados compactos y el historial plegado. */
export function ErroresTab({ errores, busy, onDecide }: Props) {
  const { pendientes, aprobados, historial } = groupErrores(errores);
  return (
    <div className="space-y-5">
      <section aria-label="Errores pendientes" className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-600">Pendientes ({pendientes.length})</h3>
        {pendientes.length === 0 && <p className="text-sm text-gray-500">No hay errores esperando decisión.</p>}
        <ul className="space-y-2">
          {pendientes.map((e) => (
            <li key={e.id} className="neumorphic-inset rounded-xl p-3 space-y-2">
              <Detalle e={e} />
              <div className="flex gap-2 pt-1">
                <Button size="sm" disabled={busy} onClick={() => onDecide(e.id, "aprobar")}>Aprobar</Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => onDecide(e.id, "rechazar")}>Rechazar</Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Errores aprobados" className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-600">Errores aprobados ({aprobados.length})</h3>
        {aprobados.length === 0 && <p className="text-sm text-gray-500">Todavía no aprobaste ninguno: el agente no recibe «Errores a evitar».</p>}
        <ul className="space-y-2">
          {aprobados.map((e) => (
            <li key={e.id}>
              <Fila e={e}>
                <Detalle e={e} />
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => onDecide(e.id, "desactivar")}>Desactivar</Button>
              </Fila>
            </li>
          ))}
        </ul>
      </section>

      <details className="group rounded-xl">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-bold uppercase tracking-widest text-gray-600 [&::-webkit-details-marker]:hidden">
          <ChevronRight size={14} aria-hidden className="shrink-0 transition-transform group-open:rotate-90" />
          Historial ({historial.length})
        </summary>
        <p className="mt-2 text-xs text-gray-500">Rechazados y desactivados. Podés reabrirlos para decidir de nuevo; los desactivados también se pueden volver a aprobar.</p>
        <ul className="mt-2 space-y-2">
          {historial.length === 0 && <li className="text-sm text-gray-500">El historial está vacío.</li>}
          {historial.map((e) => (
            <li key={e.id}>
              <Fila e={e}>
                <Detalle e={e} />
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => onDecide(e.id, "reabrir")}>Reabrir como pendiente</Button>
                  {e.estado === "desactivada" && <Button size="sm" disabled={busy} onClick={() => onDecide(e.id, "aprobar")}>Volver a aprobar</Button>}
                </div>
              </Fila>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
