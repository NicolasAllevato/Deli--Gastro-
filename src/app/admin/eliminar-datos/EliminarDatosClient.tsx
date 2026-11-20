"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Search, ShieldAlert, Trash2, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Segmented } from "@/app/admin/usuarios/_components/Segmented";
import {
  CHANNEL_LABELS, DELETION_CONFIRM_WORD, STATUS_LABELS,
  type DeletionAdminListing, type DeletionPreviewView, type DeletionRequestRowView, type DeletionResultView,
} from "@/lib/deletion/types";
import { formatDateTimeAR } from "@/lib/time-ar";

type Kind = "phone" | "email";
type Channel = "email" | "admin";

const KIND_OPTIONS: ReadonlyArray<{ value: Kind; label: string }> = [
  { value: "phone", label: "Teléfono" },
  { value: "email", label: "Email" },
];
const CHANNEL_OPTIONS: ReadonlyArray<{ value: Channel; label: string }> = [
  { value: "email", label: "Lo pidieron por email" },
  { value: "admin", label: "Otro canal (iniciado desde el panel)" },
];
const STATUS_TONE: Record<DeletionRequestRowView["status"], "green" | "yellow" | "red" | "blue"> = {
  completed: "green", partial: "yellow", failed: "red", pending: "blue",
};
const ROLE_LABELS: Record<string, string> = { cliente: "Cliente", repartidor: "Repartidor", admin: "Personal del local" };

const fmtDate = (iso: string | null) => (iso ? formatDateTimeAR(iso, { dateStyle: "short", timeStyle: "short" }) : "—");
const normalizeConfirm = (value: string) => value.trim().toUpperCase();

class ApiError extends Error {}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !json) throw new ApiError(json?.error ?? "No se pudo completar la acción. Probá de nuevo.");
  return json;
}

function accountsLabel(preview: DeletionPreviewView): string {
  const roles = preview.accounts.map((a) => (a.staffRole ? `${ROLE_LABELS[a.role] ?? a.role} (${a.staffRole === "admin" ? "dueño" : a.staffRole})` : ROLE_LABELS[a.role] ?? a.role));
  return roles.length > 0 ? roles.join(", ") : "Ninguna cuenta (solo datos sueltos: ficha, WhatsApp o reclamos)";
}

/** Herramienta del dueño principal: previsualiza y ejecuta la eliminación de datos personales por teléfono o email. */
export function EliminarDatosClient() {
  const [kind, setKind] = useState<Kind>("phone");
  const [value, setValue] = useState("");
  const [preview, setPreview] = useState<{ kind: Kind; value: string; data: DeletionPreviewView } | null>(null);
  const [recent, setRecent] = useState<DeletionRequestRowView[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DeletionResultView | null>(null);
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<Channel>("email");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Carga inicial: el setState ocurre dentro de la promesa, no en el cuerpo del efecto.
  useEffect(() => {
    let alive = true;
    call<DeletionAdminListing>("/api/admin/eliminar-datos")
      .then((r) => alive && setRecent(r.recent))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "No se pudo cargar."));
    return () => {
      alive = false;
    };
  }, []);

  async function search(e: FormEvent) {
    e.preventDefault();
    const query = value.trim();
    if (!query) return;
    setSearching(true);
    setError(null);
    setDone(null);
    try {
      const r = await call<DeletionAdminListing>(`/api/admin/eliminar-datos?${kind}=${encodeURIComponent(query)}`);
      setPreview(r.preview ? { kind, value: query, data: r.preview } : null);
      setRecent(r.recent);
    } catch (err: unknown) {
      setPreview(null);
      setError(err instanceof Error ? err.message : "No se pudo previsualizar.");
    } finally {
      setSearching(false);
    }
  }

  const closeModal = useCallback(() => {
    if (busy) return;
    setOpen(false);
    setConfirm("");
    setModalError(null);
  }, [busy]);

  async function execute(e: FormEvent) {
    e.preventDefault();
    if (!preview || busy || normalizeConfirm(confirm) !== DELETION_CONFIRM_WORD) return;
    setBusy(true);
    setModalError(null);
    try {
      const r = await call<{ result: DeletionResultView }>("/api/admin/eliminar-datos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [preview.kind]: preview.value, channel, confirm: DELETION_CONFIRM_WORD }),
      });
      setDone(r.result);
      setPreview(null);
      setValue("");
      setOpen(false);
      setConfirm("");
      const list = await call<DeletionAdminListing>("/api/admin/eliminar-datos").catch(() => null);
      if (list) setRecent(list.recent);
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : "No se pudo eliminar. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  const data = preview?.data ?? null;
  const canExecute = data !== null && data.found && data.blocked === null;

  return (
    <div className="page-fade flex flex-col gap-5 p-2 max-w-4xl">
      <header>
        <h1 className="font-headline text-2xl font-black text-gray-800">Eliminar datos personales</h1>
        <p className="text-sm text-gray-500 mt-1 max-w-2xl">
          Para los pedidos de eliminación que llegan por email o WhatsApp. Antes de ejecutar, verificá que quien lo pide es la persona (que escriba
          desde el email de su cuenta o desde el teléfono con el que pidió). La baja es definitiva: los pedidos se conservan sin datos personales
          (fecha, importes, medio de pago y estado).
        </p>
      </header>

      <form onSubmit={search} className="neumorphic rounded-2xl p-5 flex flex-col gap-4" aria-label="Buscar a quién eliminar">
        <Segmented
          name="eliminar-tipo"
          legend="Buscar por"
          options={KIND_OPTIONS}
          value={kind}
          onChange={(k) => {
            setKind(k);
            setValue("");
            setPreview(null);
            setError(null);
          }}
        />
        <Field
          label={kind === "phone" ? "Teléfono (con o sin código de país)" : "Email de la cuenta"}
          type={kind === "phone" ? "tel" : "email"}
          required
          value={value}
          maxLength={kind === "phone" ? 32 : 254}
          autoComplete="off"
          inputMode={kind === "phone" ? "tel" : "email"}
          onChange={(e) => setValue(e.target.value)}
          hint="Solo se muestra cuántos registros hay por tabla, nunca los datos de la persona."
        />
        <div>
          <Button type="submit" leftIcon={<Search size={16} aria-hidden />} loading={searching} disabled={!value.trim()}>
            Previsualizar
          </Button>
        </div>
      </form>

      <div aria-live="polite" className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="text-sm font-bold text-red-600">
            {error}
          </p>
        )}

        {done && (
          <p role="status" className="rounded-xl neumorphic px-4 py-3 text-sm text-gray-700">
            {done.found
              ? `Listo: se eliminaron o anonimizaron ${done.total} registros${done.files.total > 0 ? ` y ${done.files.total - done.files.failed} de ${done.files.total} fotos` : ""}.`
              : "No había datos para eliminar (ya estaba hecho o no existían). Quedó registrado."}
            {done.status === "partial" && " Algunas fotos no se pudieron borrar: quedaron anotadas en el registro de abajo."}
          </p>
        )}

        {data && !data.found && (
          <p role="status" className="rounded-xl neumorphic-inset px-4 py-3 text-sm text-gray-600">
            No encontramos datos asociados a ese {preview?.kind === "phone" ? "teléfono" : "email"}.
          </p>
        )}

        {data?.blocked && (
          <p role="alert" className="flex items-start gap-2 rounded-xl neumorphic px-4 py-3 text-sm font-bold text-red-600">
            <ShieldAlert size={17} className="shrink-0 mt-0.5" aria-hidden />
            {data.blocked.reason}
          </p>
        )}

        {data && data.found && (
          <section aria-labelledby="eliminar-previsualizacion" className="neumorphic rounded-2xl p-5 flex flex-col gap-3">
            <h2 id="eliminar-previsualizacion" className="font-headline text-base font-black text-gray-800">
              Qué se va a eliminar
            </h2>
            <p className="text-xs text-gray-600">Cuentas encontradas: {accountsLabel(data)}</p>
            {data.warnings.map((w) => (
              <p key={w} role="note" className="flex items-start gap-2 text-xs text-gray-700 rounded-xl neumorphic-inset px-4 py-2.5">
                <TriangleAlert size={15} className="shrink-0 mt-0.5 text-brand-orange" aria-hidden />
                {w}
              </p>
            ))}
            <div className="overflow-x-auto rounded-xl neumorphic-inset">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Registros por tabla que se eliminan o se anonimizan</caption>
                <thead>
                  <tr className="text-[11px] uppercase tracking-widest text-gray-500">
                    <th scope="col" className="px-4 py-2.5">Dato</th>
                    <th scope="col" className="px-4 py-2.5">Qué se hace</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Registros</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.key} className="border-t border-gray-200/60">
                      <td className="px-4 py-2 text-gray-800">{r.label}</td>
                      <td className="px-4 py-2">
                        <Badge tone={r.action === "delete" ? "red" : "blue"}>{r.action === "delete" ? "Se borra" : "Se anonimiza"}</Badge>
                      </td>
                      <td className="px-4 py-2 text-right font-bold text-gray-800">{r.count}</td>
                    </tr>
                  ))}
                  {data.files > 0 && (
                    <tr className="border-t border-gray-200/60">
                      <td className="px-4 py-2 text-gray-800">Fotos de reclamos (archivos)</td>
                      <td className="px-4 py-2"><Badge tone="red">Se borra</Badge></td>
                      <td className="px-4 py-2 text-right font-bold text-gray-800">{data.files}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-500">Total: {data.total} registros.</p>
            {canExecute && (
              <div>
                <Button type="button" variant="danger" leftIcon={<Trash2 size={16} aria-hidden />} onClick={() => setOpen(true)}>
                  Eliminar estos datos
                </Button>
              </div>
            )}
          </section>
        )}
      </div>

      <section aria-labelledby="eliminar-recientes" className="flex flex-col gap-2">
        <h2 id="eliminar-recientes" className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Pedidos de eliminación recientes</h2>
        <p className="text-xs text-gray-500">El registro no guarda teléfonos ni emails: solo la fecha, el canal, el estado y cuántos registros se tocaron.</p>
        {recent === null && !error && <div className="h-24 rounded-2xl shimmer" aria-hidden />}
        {recent && (
          <div className="neumorphic rounded-2xl overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Pedidos de eliminación recientes</caption>
              <thead>
                <tr className="text-[11px] uppercase tracking-widest text-gray-500">
                  <th scope="col" className="px-4 py-3">Fecha</th>
                  <th scope="col" className="px-4 py-3">Canal</th>
                  <th scope="col" className="px-4 py-3">Estado</th>
                  <th scope="col" className="px-4 py-3 text-right">Registros</th>
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500">Todavía no hubo pedidos.</td></tr>
                )}
                {recent.map((r) => (
                  <tr key={r.id} className="border-t border-gray-200/60 align-top">
                    <td className="px-4 py-3 text-gray-800">{fmtDate(r.completedAt ?? r.requestedAt)}</td>
                    <td className="px-4 py-3 text-gray-600">{CHANNEL_LABELS[r.channel]}</td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                      {r.error && <p className="mt-1 text-[11px] text-gray-500 max-w-xs break-words">{r.error}</p>}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-gray-800">
                      {r.total}
                      {typeof r.counts.archivos_r2 === "number" && <span className="block text-[11px] font-medium text-gray-500">+ {r.counts.archivos_r2} fotos</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        open={open}
        onClose={closeModal}
        size="md"
        title="Eliminar datos personales"
        description={`Vas a eliminar los datos asociados a ${preview?.value ?? ""}. Es definitivo.`}
        closeOnBackdrop={!busy}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={closeModal} disabled={busy}>
              Cancelar
            </Button>
            <Button type="submit" form="eliminar-datos-form" variant="danger" loading={busy} disabled={normalizeConfirm(confirm) !== DELETION_CONFIRM_WORD}>
              Eliminar definitivamente
            </Button>
          </>
        }
      >
        <form id="eliminar-datos-form" onSubmit={execute} className="flex flex-col gap-4">
          <Segmented name="eliminar-canal" legend="Cómo llegó el pedido" options={CHANNEL_OPTIONS} value={channel} onChange={setChannel} disabled={busy} />
          <Field
            label={`Escribí ${DELETION_CONFIRM_WORD} para confirmar`}
            required
            value={confirm}
            maxLength={20}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {modalError && (
            <p role="alert" className="text-xs font-bold text-red-600">
              {modalError}
            </p>
          )}
        </form>
      </Modal>
    </div>
  );
}
