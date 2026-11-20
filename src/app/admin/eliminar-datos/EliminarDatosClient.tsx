"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Search, ShieldAlert, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { STAFF_ROLE_LABELS } from "@/lib/auth/permissions";
import {
  CHANNEL_LABELS, STATUS_LABELS,
  type DeletionAdminListing, type DeletionPreviewView, type DeletionRequestRowView, type DeletionResultView, type StaffUserView,
} from "@/lib/deletion/types";
import { formatDateTimeAR } from "@/lib/time-ar";

const STATUS_TONE: Record<DeletionRequestRowView["status"], "green" | "yellow" | "red" | "blue"> = {
  completed: "green", partial: "yellow", failed: "red", pending: "blue",
};
const ROLE_TONE = { admin: "orange", gerente: "blue", cajero: "yellow" } as const;
const FORM_ID = "eliminar-usuario-form";

const fmtDate = (iso: string | null) => (iso ? formatDateTimeAR(iso, { dateStyle: "short", timeStyle: "short" }) : "—");
const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

class ApiError extends Error {}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !json) throw new ApiError(json?.error ?? "No se pudo completar la acción. Probá de nuevo.");
  return json;
}

const post = <T,>(url: string, body: unknown) => call<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function doneMessage(r: DeletionResultView): string {
  const aviso = r.notified === "sent" ? "Se le avisó por email." : r.notified === "failed" ? "No se pudo mandar el aviso por email (el borrado vale igual)." : "No hay servicio de correo: no se mandó aviso.";
  return `Listo: se eliminó la cuenta de acceso (${r.total} registros). El historial quedó como estaba. ${aviso}`;
}

/** Herramienta del dueño principal: elegir un usuario de la app, ver la vista previa y confirmar con su contraseña y el email exacto. */
export function EliminarDatosClient() {
  const [users, setUsers] = useState<StaffUserView[] | null>(null);
  const [recent, setRecent] = useState<DeletionRequestRowView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [target, setTarget] = useState<StaffUserView | null>(null);
  const [preview, setPreview] = useState<DeletionPreviewView | null>(null);
  const [password, setPassword] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const load = useCallback(async (email?: string) => {
    const r = await call<DeletionAdminListing>(`/api/admin/eliminar-datos${email ? `?email=${encodeURIComponent(email)}` : ""}`);
    setUsers(r.users);
    setRecent(r.recent);
  }, []);

  // Carga inicial: el setState ocurre dentro de la promesa, no en el cuerpo del efecto.
  useEffect(() => {
    let alive = true;
    call<DeletionAdminListing>("/api/admin/eliminar-datos")
      .then((r) => {
        if (!alive) return;
        setUsers(r.users);
        setRecent(r.recent);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "No se pudo cargar."));
    return () => {
      alive = false;
    };
  }, []);

  async function runSearch(e: FormEvent) {
    e.preventDefault();
    setSearching(true);
    setError(null);
    try {
      await load(search.trim() || undefined);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "No se pudo buscar.");
    } finally {
      setSearching(false);
    }
  }

  async function openPreview(user: StaffUserView) {
    setTarget(user);
    setPreview(null);
    setPassword("");
    setConfirmEmail("");
    setModalError(null);
    setDone(null);
    try {
      setPreview((await post<{ preview: DeletionPreviewView }>("/api/admin/eliminar-datos/vista-previa", { userId: user.id })).preview);
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : "No se pudo hacer la vista previa.");
    }
  }

  const closeModal = useCallback(() => {
    if (busy) return;
    setTarget(null);
    setPreview(null);
    setPassword("");
    setConfirmEmail("");
    setModalError(null);
  }, [busy]);

  async function execute(e: FormEvent) {
    e.preventDefault();
    if (!target || !preview?.token || busy) return;
    setBusy(true);
    setModalError(null);
    try {
      const r = await post<{ result: DeletionResultView }>("/api/admin/eliminar-datos", { userId: target.id, token: preview.token, password, confirmEmail });
      setDone(doneMessage(r.result));
      setTarget(null);
      setPreview(null);
      setPassword("");
      setConfirmEmail("");
      await load(search.trim() || undefined).catch(() => undefined);
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : "No se pudo eliminar. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  const ready = !!preview?.token && password.length > 0 && !!target && sameEmail(confirmEmail, target.email);

  return (
    <div className="page-fade flex flex-col gap-5 p-2 max-w-4xl">
      <header>
        <h1 className="font-headline text-2xl font-black text-gray-800">Eliminar usuarios de la app</h1>
        <p className="text-sm text-gray-500 mt-1 max-w-2xl">
          Elegí a alguien del personal, mirá qué se borra y confirmá con tu contraseña y el email exacto del usuario. Solo se borra su cuenta de acceso (usuario,
          sesiones, contraseña y tokens): los pedidos, clientes, WhatsApp y el resto del historial quedan como están. Al terminar se le avisa por email.
        </p>
      </header>

      <form onSubmit={runSearch} className="neumorphic rounded-2xl p-5 flex flex-col gap-3" aria-label="Buscar un usuario por email exacto">
        <Field
          label="Buscar por email exacto"
          type="email"
          value={search}
          maxLength={254}
          autoComplete="off"
          onChange={(e) => setSearch(e.target.value)}
          hint="Dejalo vacío para ver a todo el personal. No busca por partes del email."
        />
        <div>
          <Button type="submit" leftIcon={<Search size={16} aria-hidden />} loading={searching}>
            {search.trim() ? "Buscar" : "Ver todos"}
          </Button>
        </div>
      </form>

      <div aria-live="polite" className="flex flex-col gap-3">
        {error && (
          <p role="alert" className="flex items-start gap-2 text-sm font-bold text-red-600">
            <ShieldAlert size={17} className="shrink-0 mt-0.5" aria-hidden />
            {error}
          </p>
        )}
        {done && <p role="status" className="rounded-xl neumorphic px-4 py-3 text-sm text-gray-700">{done}</p>}
      </div>

      <section aria-labelledby="eliminar-usuarios" className="flex flex-col gap-2">
        <h2 id="eliminar-usuarios" className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Personal de la app</h2>
        {users === null && !error && <div className="h-24 rounded-2xl shimmer" aria-hidden />}
        {users && (
          <div className="neumorphic rounded-2xl overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Usuarios del personal que se pueden eliminar</caption>
              <thead>
                <tr className="text-[11px] uppercase tracking-widest text-gray-500">
                  <th scope="col" className="px-4 py-3">Usuario</th>
                  <th scope="col" className="px-4 py-3">Rol</th>
                  <th scope="col" className="px-4 py-3">Estado</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500">No hay usuarios con ese email.</td></tr>}
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-gray-200/60 align-top">
                    <td className="px-4 py-3">
                      <p className="font-bold text-gray-800">{u.name || "Sin nombre"}</p>
                      <p className="text-xs text-gray-500">{u.email}</p>
                    </td>
                    <td className="px-4 py-3"><Badge tone={ROLE_TONE[u.staffRole]}>{STAFF_ROLE_LABELS[u.staffRole]}</Badge></td>
                    <td className="px-4 py-3"><Badge tone={u.banned ? "red" : "green"}>{u.banned ? "Bloqueado" : "Activo"}</Badge></td>
                    <td className="px-4 py-3 text-right">
                      {u.blockedReason ? (
                        <span className="text-xs text-gray-500 max-w-[14rem] inline-block text-right">{u.blockedReason}</span>
                      ) : (
                        <Button type="button" variant="danger" size="sm" leftIcon={<Trash2 size={14} aria-hidden />} aria-label={`Eliminar a ${u.name || u.email}`} onClick={() => void openPreview(u)}>
                          Eliminar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="eliminar-recientes" className="flex flex-col gap-2">
        <h2 id="eliminar-recientes" className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Eliminaciones recientes</h2>
        <p className="text-xs text-gray-500">El registro no guarda emails ni nombres: solo la fecha, el canal, el estado y cuántos registros se borraron.</p>
        {recent && (
          <div className="neumorphic rounded-2xl overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Eliminaciones de usuarios recientes</caption>
              <thead>
                <tr className="text-[11px] uppercase tracking-widest text-gray-500">
                  <th scope="col" className="px-4 py-3">Fecha</th>
                  <th scope="col" className="px-4 py-3">Canal</th>
                  <th scope="col" className="px-4 py-3">Estado</th>
                  <th scope="col" className="px-4 py-3 text-right">Registros</th>
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500">Todavía no hubo eliminaciones.</td></tr>}
                {recent.map((r) => (
                  <tr key={r.id} className="border-t border-gray-200/60">
                    <td className="px-4 py-3 text-gray-800">{fmtDate(r.completedAt ?? r.requestedAt)}</td>
                    <td className="px-4 py-3 text-gray-600">{CHANNEL_LABELS[r.channel]}</td>
                    <td className="px-4 py-3"><Badge tone={STATUS_TONE[r.status]}>{STATUS_LABELS[r.status]}</Badge></td>
                    <td className="px-4 py-3 text-right font-bold text-gray-800">{r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        open={target !== null}
        onClose={closeModal}
        size="md"
        title="Eliminar usuario"
        description={target ? `${target.name || "Sin nombre"} · ${target.email}. Es definitivo.` : undefined}
        closeOnBackdrop={!busy}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={closeModal} disabled={busy}>Cancelar</Button>
            <Button type="submit" form={FORM_ID} variant="danger" loading={busy} disabled={!ready}>Eliminar definitivamente</Button>
          </>
        }
      >
        {!preview && !modalError && <div className="h-24 rounded-2xl shimmer" aria-hidden />}
        {preview && (
          <form id={FORM_ID} onSubmit={execute} className="flex flex-col gap-4">
            <p className="text-xs text-gray-600">
              Rol: <strong>{STAFF_ROLE_LABELS[preview.user.staffRole]}</strong> · {preview.user.banned ? "bloqueado" : "activo"}
            </p>
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-1">Se borra</h3>
              <ul className="rounded-xl neumorphic-inset px-4 py-2 text-xs text-gray-700 flex flex-col gap-1">
                {preview.deletes.map((d) => (
                  <li key={d.key} className="flex justify-between gap-3"><span>{d.label}</span><strong>{d.count}</strong></li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-1">Se conserva</h3>
              <ul className="list-disc pl-5 text-xs text-gray-600 flex flex-col gap-0.5">
                {preview.keeps.map((k) => <li key={k}>{k}</li>)}
              </ul>
            </div>
            <Field label="Tu contraseña" type="password" required value={password} maxLength={128} autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />
            <Field
              label="Escribí el email exacto del usuario"
              type="email"
              required
              value={confirmEmail}
              maxLength={254}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setConfirmEmail(e.target.value)}
              hint={target ? `Para confirmar, escribí ${target.email}` : undefined}
            />
          </form>
        )}
        {modalError && (
          <p role="alert" className="mt-3 text-xs font-bold text-red-600">{modalError}</p>
        )}
      </Modal>
    </div>
  );
}
