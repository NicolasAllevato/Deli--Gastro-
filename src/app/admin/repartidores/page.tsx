"use client";

import { useEffect, useState } from "react";
import { Bike, KeyRound, Loader2, Pencil, Plus, Power, Shuffle } from "lucide-react";
import type { Courier } from "@/lib/courier-pins";
import { CourierShiftsToday } from "../_components/CourierShifts";
import { EditCourierModal, PinReveal } from "./CourierRowTools";

interface PinNotice {
  name: string;
  pin: string;
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { dateStyle: "short" });

async function send<T>(url: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "No se pudo guardar.");
  return json;
}

/** El PIN se muestra una sola vez, al crearlo o cambiarlo: después solo queda su hash. */
function PinBanner({ notice, onClose }: { notice: PinNotice; onClose: () => void }) {
  return (
    <section role="status" className="neumorphic rounded-2xl p-5 border border-brand-orange/40 space-y-2">
      <p className="text-sm text-gray-600">
        PIN de <strong className="text-gray-800">{notice.name}</strong>. Pasáselo ahora; después lo podés volver a ver con &quot;Mostrar clave&quot;.
      </p>
      <p className="font-headline text-4xl font-black tracking-[0.4em] text-brand-orange">{notice.pin}</p>
      <button type="button" onClick={onClose} className="text-xs font-bold text-gray-500 hover:text-gray-700">
        Listo, ya lo anoté
      </button>
    </section>
  );
}

function NewCourierForm({ onCreated }: { onCreated: (c: Courier, pin: string) => void }) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await send<{ courier: Courier; pin: string }>("/api/admin/couriers", "POST", {
        name,
        ...(pin ? { pin } : {}),
      });
      onCreated(res.courier, res.pin);
      setName("");
      setPin("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "No se pudo crear el repartidor.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="neumorphic rounded-2xl p-5 grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
      <label className="space-y-1.5">
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Nombre</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
          maxLength={60}
          placeholder="Ej.: Juan Pérez"
          className="w-full px-4 py-3 rounded-xl neumorphic-inset text-sm text-gray-700 outline-none focus:ring-2 focus:ring-brand-orange/40"
        />
      </label>
      <label className="space-y-1.5">
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">PIN (opcional)</span>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          inputMode="numeric"
          pattern="\d{4}"
          placeholder="Al azar"
          aria-describedby="pin-help"
          className="w-full px-4 py-3 rounded-xl neumorphic-inset text-sm text-gray-700 tracking-widest outline-none focus:ring-2 focus:ring-brand-orange/40"
        />
      </label>
      <button
        type="submit"
        disabled={busy || name.trim().length < 2 || (pin.length > 0 && pin.length !== 4)}
        className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl btn-glow text-white font-black text-sm disabled:opacity-50"
      >
        {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Plus size={16} aria-hidden />} Dar de alta
      </button>
      <p id="pin-help" className="text-xs text-gray-500 sm:col-span-3">
        Cada repartidor entra a la app solo con su PIN de 4 números. Si no elegís uno, se genera al azar.
      </p>
      {error && <p role="alert" className="text-xs font-bold text-red-600 sm:col-span-3">{error}</p>}
    </form>
  );
}

export default function CouriersAdminPage() {
  const [couriers, setCouriers] = useState<Courier[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<PinNotice | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Courier | null>(null);

  useEffect(() => {
    fetch("/api/admin/couriers", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Error al cargar.");
        setCouriers((await res.json()) as Courier[]);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Error al cargar."));
  }, []);

  const replace = (c: Courier) =>
    setCouriers((list) => (list ?? []).map((x) => (x.userId === c.userId ? c : x)));

  const act = async (c: Courier, body: { action: "pin" } | { action: "active"; active: boolean }) => {
    setBusyId(c.userId);
    setError(null);
    try {
      const res = await send<{ courier: Courier; pin?: string }>(`/api/admin/couriers/${c.userId}`, "PATCH", body);
      replace(res.courier);
      if (res.pin) setNotice({ name: res.courier.name, pin: res.pin });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page-fade flex flex-col gap-4 p-2">
      <header>
        <h1 className="font-headline text-2xl font-black text-gray-800">Repartidores</h1>
        <p className="text-sm text-gray-500 mt-1">
          Alta de repartidores y su PIN de ingreso. Con el PIN entran a la app de reparto y comparten su ubicación
          mientras tienen entregas.
        </p>
      </header>

      {notice && <PinBanner notice={notice} onClose={() => setNotice(null)} />}

      <CourierShiftsToday />

      <NewCourierForm
        onCreated={(c, pin) => {
          setCouriers((list) => [...(list ?? []), c].sort((a, b) => a.name.localeCompare(b.name, "es")));
          setNotice({ name: c.name, pin });
        }}
      />

      {error && <p role="alert" className="text-xs font-bold text-red-600 px-3 py-2 rounded-lg bg-red-50 border border-red-100">{error}</p>}

      {couriers === null && !error ? (
        <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden /> Cargando…</p>
      ) : couriers && couriers.length === 0 ? (
        <div className="neumorphic-inset rounded-2xl p-6 text-center text-sm text-gray-500">
          Todavía no hay repartidores con PIN. Dá de alta el primero arriba.
        </div>
      ) : (
        <ul className="grid gap-3" aria-label="Repartidores">
          {(couriers ?? []).map((c) => (
            <li key={c.userId} className="neumorphic rounded-2xl p-4 flex flex-wrap items-center gap-3">
              <span className="w-10 h-10 rounded-xl neumorphic-inset flex items-center justify-center text-brand-orange shrink-0">
                <Bike size={18} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-black text-gray-800 truncate">{c.name}</p>
                <p className="text-xs text-gray-500">
                  {c.active ? <span className="badge-green px-2 py-0.5 rounded-full font-bold">Activo</span>
                    : <span className="badge-red px-2 py-0.5 rounded-full font-bold">Desactivado</span>}
                  <span className="ml-2">Actualizado el {fmt(c.updatedAt)}</span>
                </p>
                <PinReveal courier={c} revision={c.updatedAt} />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busyId === c.userId}
                  onClick={() => setEditing(c)}
                  aria-label={`Editar a ${c.name}`}
                  className="w-9 h-9 rounded-xl neumorphic-inset flex items-center justify-center text-gray-600 disabled:opacity-50"
                >
                  <Pencil size={14} aria-hidden />
                </button>
                <button
                  type="button"
                  disabled={busyId === c.userId}
                  onClick={() => act(c, { action: "pin" })}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl neumorphic-inset text-xs font-black text-brand-orange disabled:opacity-50"
                >
                  <Shuffle size={14} aria-hidden /> Resetear clave
                </button>
                <button
                  type="button"
                  disabled={busyId === c.userId}
                  onClick={() => act(c, { action: "active", active: !c.active })}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl neumorphic-inset text-xs font-black text-gray-600 disabled:opacity-50"
                >
                  {c.active ? <Power size={14} aria-hidden /> : <KeyRound size={14} aria-hidden />}
                  {c.active ? "Desactivar" : "Activar"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <EditCourierModal
          courier={editing}
          onClose={() => setEditing(null)}
          onSaved={(c) => {
            replace(c);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
