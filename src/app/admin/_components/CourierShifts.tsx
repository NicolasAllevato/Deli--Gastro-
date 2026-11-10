"use client";

import { useCallback, useState } from "react";
import { Bike, Check, Loader2, X } from "lucide-react";
import type { CourierShift } from "@/lib/courier-shifts";
import { TOPIC_COURIER_SHIFTS } from "@/lib/live-refresh";
import { useLiveRefresh } from "@/lib/useLiveRefresh";

const DEMO_POLL_MS = 15_000;

const time = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

const STATUS_LABEL: Record<CourierShift["status"], { text: string; className: string }> = {
  pending: { text: "Esperando", className: "badge-yellow" },
  approved: { text: "Habilitado", className: "badge-green" },
  rejected: { text: "No habilitado", className: "badge-red" },
};

/** Lee las habilitaciones del día y se actualiza sola cuando un repartidor abre su sesión. */
function useCourierShifts() {
  const [shifts, setShifts] = useState<CourierShift[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/courier-shifts", { cache: "no-store" });
      if (res.ok) setShifts((await res.json()) as CourierShift[]);
    } catch {
      /* sin red: se reintenta con el próximo aviso */
    }
  }, []);

  useLiveRefresh({ topic: TOPIC_COURIER_SHIFTS, refresh, demoPollMs: DEMO_POLL_MS });

  const decide = async (id: string, status: "approved" | "rejected") => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/admin/courier-shifts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "No se pudo guardar.");
      }
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusyId(null);
    }
  };

  return { shifts, busyId, error, decide };
}

interface ActionsProps {
  shift: CourierShift;
  busy: boolean;
  onDecide: (id: string, status: "approved" | "rejected") => void;
}

function ShiftActions({ shift, busy, onDecide }: ActionsProps) {
  if (busy) return <Loader2 size={16} className="animate-spin text-gray-400" aria-label="Guardando" />;
  return (
    <div className="flex gap-2 shrink-0">
      {shift.status !== "approved" && (
        <button
          type="button"
          onClick={() => onDecide(shift.id, "approved")}
          className="flex items-center gap-1 px-3 py-1.5 rounded-full btn-glow text-white text-xs font-black"
        >
          <Check size={14} aria-hidden /> Habilitar
        </button>
      )}
      {shift.status !== "rejected" && (
        <button
          type="button"
          onClick={() => onDecide(shift.id, "rejected")}
          className="flex items-center gap-1 px-3 py-1.5 rounded-full neumorphic-inset text-gray-600 text-xs font-black"
        >
          <X size={14} aria-hidden /> {shift.status === "approved" ? "Deshabilitar" : "Rechazar"}
        </button>
      )}
    </div>
  );
}

/** Aviso del panel: los repartidores que abrieron su sesión y esperan que el local los habilite hoy. */
export function CourierShiftAlerts() {
  const { shifts, busyId, error, decide } = useCourierShifts();
  const pending = shifts.filter((s) => s.status === "pending");
  if (pending.length === 0) return null;

  return (
    <section role="alert" aria-label="Repartidores esperando habilitación" className="mx-3 mb-2 space-y-2">
      {pending.map((shift) => (
        <div key={shift.id} className="neumorphic rounded-2xl px-4 py-3 flex items-center justify-between gap-3 border border-brand-orange/40">
          <p className="flex items-center gap-2 text-sm text-gray-700 min-w-0">
            <Bike size={16} className="text-brand-orange shrink-0" aria-hidden />
            <span className="truncate">
              <strong>{shift.courierName}</strong> abrió su sesión a las {time(shift.requestedAt)}. ¿Lo habilitás hoy?
            </span>
          </p>
          <ShiftActions shift={shift} busy={busyId === shift.id} onDecide={decide} />
        </div>
      ))}
      {error && <p className="text-xs font-bold text-red-600 px-2">{error}</p>}
    </section>
  );
}

/** Lista del día en la pantalla de repartidores: quién pidió, quién está habilitado y quién no. */
export function CourierShiftsToday() {
  const { shifts, busyId, error, decide } = useCourierShifts();

  return (
    <section aria-labelledby="shifts-title" className="neumorphic rounded-2xl p-5 space-y-3">
      <div>
        <h2 id="shifts-title" className="font-headline font-black text-gray-800">Habilitados hoy</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Cada repartidor pide la habilitación al abrir su sesión. Solo los habilitados toman pedidos y reciben los
          deliveries de Fudo. El día cambia a las 6 de la mañana.
        </p>
      </div>
      {shifts.length === 0 ? (
        <p className="text-sm text-gray-500">Todavía ningún repartidor abrió su sesión hoy.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {shifts.map((shift) => {
            const label = STATUS_LABEL[shift.status];
            return (
              <li key={shift.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="font-bold text-sm text-gray-800 truncate">{shift.courierName}</p>
                  <p className="text-[11px] text-gray-500">Pidió a las {time(shift.requestedAt)}</p>
                </div>
                <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${label.className}`}>{label.text}</span>
                <ShiftActions shift={shift} busy={busyId === shift.id} onDecide={decide} />
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="text-xs font-bold text-red-600">{error}</p>}
    </section>
  );
}
