"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Save, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui";
import type { FudoCatalogItem, MappingState, SaveInput, SkippedSummary } from "@/lib/fudo/mapping";

interface MapResponse extends MappingState {
  catalog: FudoCatalogItem[];
  gatewayConfigured: boolean;
  skipped: SkippedSummary;
}

const NO_SKIPPED: SkippedSummary = { byMapping: { count: 0, oldestAt: null, recentCount: 0 }, otherSkipped: 0, stuck: 0 };

function hasSkippedNotice(s: SkippedSummary | undefined): s is SkippedSummary {
  return !!s && (s.byMapping.count > 0 || s.otherSkipped > 0 || s.stuck > 0);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const inputClass =
  "w-28 px-3 py-2 rounded-xl neumorphic-inset text-sm text-gray-700 outline-none focus:ring-2 focus:ring-brand-orange/40";

async function request<T>(method: "GET" | "PUT", body?: unknown): Promise<T> {
  const res = await fetch("/api/admin/fudo-map", {
    method,
    cache: "no-store",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new HttpError(json.error ?? "No se pudo completar la operación.", res.status);
  return json;
}

class HttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Ids que el servidor nombra tras los dos puntos ("…catálogo de Fudo: 6, 9. Revisalo…"). */
function idsInMessage(message: string): Set<number> {
  const list = /:\s*([\d,\s]+)\./.exec(message)?.[1] ?? "";
  return new Set(list.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0));
}

const MAX_FUDO_ID = 2_147_483_647;

function toId(value: string): number | null {
  const n = Number(value);
  return /^\d+$/.test(value.trim()) && Number.isSafeInteger(n) && n > 0 && n <= MAX_FUDO_ID ? n : null;
}

const isInvalidDraft = (value: string): boolean => value.trim() !== "" && toId(value) === null;
const invalidRing = "ring-2 ring-red-400";

export default function FudoMapPage() {
  const [data, setData] = useState<MapResponse | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [requeued, setRequeued] = useState(0);
  const [staleNotice, setStaleNotice] = useState(false);
  const [rejectedIds, setRejectedIds] = useState<Set<number>>(new Set());

  const load = (next: MapResponse) => {
    setData(next);
    const d: Record<string, string> = {};
    for (const p of next.products) if (p.fudoProductId !== null) d[`p:${p.id}`] = String(p.fudoProductId);
    for (const p of next.payments) if (p.fudoPaymentMethodId !== null) d[`m:${p.method}`] = String(p.fudoPaymentMethodId);
    setDrafts(d);
  };

  const fetchState = async (): Promise<void> => {
    try {
      load(await request<MapResponse>("GET"));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al cargar.");
    }
  };

  useEffect(() => {
    request<MapResponse>("GET").then(load).catch((e: unknown) => setError(e instanceof Error ? e.message : "Error al cargar."));
  }, []);

  const retry = () => {
    setError(null);
    void fetchState();
  };

  const catalogById = useMemo(() => new Map((data?.catalog ?? []).map((c) => [c.id, c.name])), [data]);

  const diff = useMemo((): { input: SaveInput; invalid: boolean } | null => {
    if (!data) return null;
    const input: SaveInput = { products: [], payments: [], removeProducts: [], removePayments: [] };
    let invalid = false;
    for (const p of data.products) {
      const raw = (drafts[`p:${p.id}`] ?? "").trim();
      if (raw === "") {
        if (p.fudoProductId !== null) input.removeProducts.push(p.id);
        continue;
      }
      const id = toId(raw);
      if (id === null) { invalid = true; continue; }
      if (id !== p.fudoProductId) input.products.push({ productId: p.id, fudoProductId: id, fudoName: catalogById.get(id) ?? null });
    }
    for (const m of data.payments) {
      const raw = (drafts[`m:${m.method}`] ?? "").trim();
      if (raw === "") {
        if (m.fudoPaymentMethodId !== null) input.removePayments.push(m.method);
        continue;
      }
      const id = toId(raw);
      if (id === null) { invalid = true; continue; }
      if (id !== m.fudoPaymentMethodId) input.payments.push({ paymentMethod: m.method, fudoPaymentMethodId: id });
    }
    return { input, invalid };
  }, [data, drafts, catalogById]);

  const changes = diff ? diff.input.products.length + diff.input.payments.length + diff.input.removeProducts.length + diff.input.removePayments.length : 0;

  const removals = diff ? diff.input.removeProducts.length + diff.input.removePayments.length : 0;

  const runSave = async () => {
    if (!diff || diff.invalid || changes === 0) return;
    setConfirming(false);
    setBusy(true);
    setError(null);
    setSaved(false);
    setRequeued(0);
    setRejectedIds(new Set());
    try {
      const res = await request<MapResponse & { requeued: number }>("PUT", diff.input);
      load({ ...res, catalog: data?.catalog ?? [], gatewayConfigured: data?.gatewayConfigured ?? false, skipped: data?.skipped ?? NO_SKIPPED });
      setRequeued(res.requeued ?? 0);
      setSaved(true);
      // El PUT no trae el aviso: se relee para que baje la cuenta de omitidos.
      setStaleNotice(false);
      request<MapResponse>("GET")
        .then((fresh) => setData((d) => (d ? { ...d, skipped: fresh.skipped ?? NO_SKIPPED } : d)))
        .catch(() => setStaleNotice(true));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "No se pudo guardar.";
      if (e instanceof HttpError && e.status === 400) {
        // Error de validación: se conservan las ediciones y se marcan los ids rechazados.
        setRejectedIds(idsInMessage(message));
        setError(message);
      } else {
        await fetchState(); // 5xx o red: vuelve al estado real de la base
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const onSaveClick = () => (removals > 0 ? setConfirming(true) : void runSave());

  const setDraft = (key: string, value: string) => {
    setSaved(false);
    setDrafts((d) => ({ ...d, [key]: value.replace(/\D/g, "").slice(0, 10) }));
  };

  return (
    <div className="page-fade flex flex-col gap-4 p-2">
      <header>
        <h1 className="font-headline text-2xl font-black text-gray-800">Mapeo con Fudo</h1>
        <p className="text-sm text-gray-500 mt-1">
          Cada producto y medio de pago de la app necesita su id de Fudo. Sin mapeo, el pedido no se envía a Fudo y queda omitido.
        </p>
      </header>

      {error && (
        <div role="alert" className="badge-red text-xs font-bold px-3 py-2 rounded-lg flex flex-wrap items-center gap-3">
          <span>{error}</span>
          {!data && (
            <button type="button" onClick={retry} className="underline">Reintentar</button>
          )}
        </div>
      )}

      {!data && !error && (
        <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden /> Cargando…</p>
      )}

      {data && (
        <>
          {data.gatewayConfigured && hasSkippedNotice(data.skipped) && (
            <div role="status" className="badge-orange text-xs font-bold px-3 py-2 rounded-lg flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
              <div className="space-y-1">
                {data.skipped.byMapping.count > 0 && (
                  <p>
                    {data.skipped.byMapping.count} {data.skipped.byMapping.count === 1 ? "pedido no llegó" : "pedidos no llegaron"} a Fudo por productos sin mapear
                    {data.skipped.byMapping.oldestAt ? ` (el más viejo: ${formatDate(data.skipped.byMapping.oldestAt)})` : ""}.
                    {" "}Cargá el mapeo y guardá: los de las últimas 24 h ({data.skipped.byMapping.recentCount}) se reenvían al guardar; los más viejos no se reenvían solos, pasalos a Fudo a mano.
                  </p>
                )}
                {data.skipped.otherSkipped > 0 && (
                  <p>
                    {data.skipped.otherSkipped} {data.skipped.otherSkipped === 1 ? "pedido fue rechazado o no se pudo enviar" : "pedidos fueron rechazados o no se pudieron enviar"} a Fudo por otro motivo: revisá la integración.
                  </p>
                )}
                {data.skipped.stuck > 0 && (
                  <p>
                    {data.skipped.stuck} {data.skipped.stuck === 1 ? "pedido lleva" : "pedidos llevan"} más de 10 minutos esperando para enviarse a Fudo: revisá que el gateway esté funcionando.
                  </p>
                )}
              </div>
            </div>
          )}

          <section role="status" className="neumorphic rounded-2xl p-4 flex flex-wrap items-center gap-3 text-sm text-gray-600">
            {data.unmappedProducts + data.unmappedPayments === 0 ? (
              <span className="badge-green px-2.5 py-1 rounded-full text-[11px] font-bold inline-flex items-center gap-1.5">
                <CheckCircle2 size={13} aria-hidden /> Todo mapeado
              </span>
            ) : (
              <span className="badge-yellow px-2.5 py-1 rounded-full text-[11px] font-bold inline-flex items-center gap-1.5">
                <AlertTriangle size={13} aria-hidden />
                {data.unmappedProducts} productos y {data.unmappedPayments} medios de pago sin mapear
              </span>
            )}
            <span className="text-xs text-gray-500">
              {data.catalog.length > 0
                ? `Catálogo de Fudo disponible (${data.catalog.length} productos): escribí el id o elegilo de la lista.`
                : data.gatewayConfigured
                  ? "No se pudo leer el catálogo de Fudo: cargá los ids a mano."
                  : "Integración con Fudo sin configurar: cargá los ids a mano."}
            </span>
          </section>

          <datalist id="fudo-catalog">
            {data.catalog.map((c) => <option key={c.id} value={c.id} label={`${c.id} · ${c.name}`} />)}
          </datalist>

          <section className="neumorphic rounded-2xl p-4 space-y-3" aria-labelledby="pagos-title">
            <h2 id="pagos-title" className="font-headline text-lg font-black text-gray-800">Medios de pago</h2>
            <ul className="grid gap-2">
              {data.payments.map((m) => (
                <li key={m.method} className="flex flex-wrap items-center gap-3">
                  <span className="flex-1 min-w-32 font-bold text-gray-800">{m.method}</span>
                  <input
                    value={drafts[`m:${m.method}`] ?? ""}
                    onChange={(e) => setDraft(`m:${m.method}`, e.target.value)}
                    inputMode="numeric"
                    placeholder="Id en Fudo"
                    aria-label={`Id de Fudo para ${m.method}`}
                    aria-invalid={isInvalidDraft(drafts[`m:${m.method}`] ?? "") || undefined}
                    className={`${inputClass} ${isInvalidDraft(drafts[`m:${m.method}`] ?? "") ? invalidRing : ""}`}
                  />
                </li>
              ))}
            </ul>
          </section>

          <section className="neumorphic rounded-2xl p-4 space-y-3" aria-labelledby="productos-title">
            <h2 id="productos-title" className="font-headline text-lg font-black text-gray-800">Productos</h2>
            {data.products.length === 0 ? (
              <p className="neumorphic-inset rounded-xl p-5 text-center text-sm text-gray-500">Todavía no hay productos en la app.</p>
            ) : (
              <ul className="grid gap-2" aria-label="Productos de la app">
                {data.products.map((p) => {
                  const draft = drafts[`p:${p.id}`] ?? "";
                  const id = toId(draft);
                  const fudoName = id !== null ? catalogById.get(id) ?? (id === p.fudoProductId ? p.fudoName : null) : null;
                  return (
                    <li key={p.id} className="flex flex-wrap items-center gap-3">
                      <div className="flex-1 min-w-40">
                        <p className="font-bold text-gray-800 truncate">{p.name}</p>
                        <p className="text-xs text-gray-500">
                          {p.category ?? "Sin categoría"}
                          {!p.isActive && <span className="ml-2">· Inactivo</span>}
                          {fudoName && <span className="ml-2 text-gray-600">· Fudo: {fudoName}</span>}
                        </p>
                      </div>
                      <input
                        value={draft}
                        onChange={(e) => setDraft(`p:${p.id}`, e.target.value)}
                        inputMode="numeric"
                        list="fudo-catalog"
                        placeholder="Id en Fudo"
                        aria-label={`Id de Fudo para ${p.name}`}
                        aria-invalid={isInvalidDraft(draft) || (id !== null && rejectedIds.has(id)) || undefined}
                        className={`${inputClass} ${isInvalidDraft(draft) || (id !== null && rejectedIds.has(id)) ? invalidRing : ""}`}
                      />
                      <button
                        type="button"
                        onClick={() => setDraft(`p:${p.id}`, "")}
                        disabled={draft === ""}
                        aria-label={`Quitar el mapeo de ${p.name}`}
                        className="inline-flex items-center justify-center min-w-11 min-h-11 rounded-xl neumorphic-inset text-gray-500 disabled:opacity-40"
                      >
                        <Trash2 size={14} aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onSaveClick}
              disabled={busy || changes === 0 || diff?.invalid}
              className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl btn-glow text-white font-black text-sm disabled:opacity-50"
            >
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Save size={16} aria-hidden />}
              Guardar cambios{changes > 0 ? ` (${changes})` : ""}
            </button>
            {diff?.invalid && (
              <p role="alert" className="badge-red text-xs font-bold px-2.5 py-1 rounded-full">
                Hay ids inválidos: tienen que ser enteros entre 1 y {MAX_FUDO_ID.toLocaleString("es-AR")}.
              </p>
            )}
            {staleNotice && (
              <p role="status" className="text-xs text-gray-500">
                No se pudo actualizar el aviso de pedidos omitidos; recargá la página para verlo.
              </p>
            )}
            {saved && (
              <p role="status" className="badge-green text-xs font-bold px-2.5 py-1 rounded-full">
                Mapeo guardado.{requeued > 0 ? ` Hasta ${requeued} ${requeued === 1 ? "pedido omitido se vuelve" : "pedidos omitidos se vuelven"} a intentar.` : ""}
              </p>
            )}
          </div>

          <Modal
            open={confirming}
            onClose={() => setConfirming(false)}
            title="Quitar mapeos"
            description={`${removals === 1 ? "Se quitará 1 mapeo" : `Se quitarán ${removals} mapeos`}. Los pedidos con esos productos o medios de pago no se enviarán a Fudo hasta volver a mapearlos.`}
            size="sm"
            footer={
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setConfirming(false)} className="px-4 py-2 rounded-xl neumorphic-inset text-sm font-black text-gray-600">
                  Cancelar
                </button>
                <button type="button" onClick={() => void runSave()} className="px-4 py-2 rounded-xl btn-glow text-white text-sm font-black">
                  Guardar igual
                </button>
              </div>
            }
          >
            <p className="text-sm text-gray-600">¿Querés guardar los cambios?</p>
          </Modal>
        </>
      )}
    </div>
  );
}
