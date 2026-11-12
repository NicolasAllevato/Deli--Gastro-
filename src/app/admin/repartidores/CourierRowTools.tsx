"use client";

import { useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button, Field, Modal } from "@/components/ui";
import type { Courier } from "@/lib/courier-pins";

const UNAVAILABLE = "No disponible — reseteá la clave para verla.";

/**
 * Clave del repartidor oculta por defecto. Se pide al servidor recién al tocar "Mostrar clave"
 * y se olvida al ocultarla. `revision` cambia cuando se resetea, para no mostrar una vieja.
 */
export function PinReveal({ courier, revision }: { courier: Courier; revision: string }) {
  const [shown, setShown] = useState<{ revision: string; pin: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visible = shown !== null && shown.revision === revision;

  const toggle = async () => {
    if (visible) {
      setShown(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/couriers/${courier.userId}/pin`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { pin?: string | null; error?: string };
      if (!res.ok) throw new Error(json.error ?? "No se pudo leer la clave.");
      setShown({ revision, pin: json.pin ?? null });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo leer la clave.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 text-xs text-gray-500">
      <span>Clave:</span>
      <span aria-live="polite" className={visible && shown?.pin ? "font-black tracking-[0.3em] text-gray-800" : ""}>
        {visible ? (shown?.pin ?? UNAVAILABLE) : "••••"}
      </span>
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-label={visible ? `Ocultar clave de ${courier.name}` : `Mostrar clave de ${courier.name}`}
        aria-pressed={visible}
        className="w-7 h-7 rounded-lg neumorphic-inset flex items-center justify-center text-gray-600 disabled:opacity-50"
      >
        {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : visible ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
      </button>
      {error && <span role="alert" className="font-bold text-red-600">{error}</span>}
    </div>
  );
}

/** Editar los datos del repartidor (hoy, el nombre). */
export function EditCourierModal({
  courier,
  onClose,
  onSaved,
}: {
  courier: Courier;
  onClose: () => void;
  onSaved: (c: Courier) => void;
}) {
  const [name, setName] = useState(courier.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = name.trim().length >= 2 && name.trim().length <= 60;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/couriers/${courier.userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "name", name: name.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { courier?: Courier; error?: string };
      if (!res.ok || !json.courier) throw new Error(json.error ?? "No se pudo guardar.");
      onSaved(json.courier);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Editar repartidor" size="sm">
      <form onSubmit={save} className="space-y-4">
        <Field
          label="Nombre"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
          maxLength={60}
          error={error ?? undefined}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy} disabled={!valid || busy}>Guardar</Button>
        </div>
      </form>
    </Modal>
  );
}
