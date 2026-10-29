"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Save, Trash2 } from "lucide-react";
import type { FudoCatalogItem, MappingState, SaveInput } from "@/lib/fudo/mapping";

interface MapResponse extends MappingState {
  catalog: FudoCatalogItem[];
  gatewayConfigured: boolean;
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
  if (!res.ok) throw new Error(json.error ?? "No se pudo completar la operación.");
  return json;
}

function toId(value: string): number | null {
  const n = Number(value);
  return /^\d+$/.test(value.trim()) && Number.isSafeInteger(n) && n > 0 ? n : null;
}

export default function FudoMapPage() {
  const [data, setData] = useState<MapResponse | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = (next: MapResponse) => {
    setData(next);
    const d: Record<string, string> = {};
    for (const p of next.products) if (p.fudoProductId !== null) d[`p:${p.id}`] = String(p.fudoProductId);
    for (const p of next.payments) if (p.fudoPaymentMethodId !== null) d[`m:${p.method}`] = String(p.fudoPaymentMethodId);
    setDrafts(d);
  };

  useEffect(() => {
    request<MapResponse>("GET").then(load).catch((e: unknown) => setError(e instanceof Error ? e.message : "Error al cargar."));
  }, []);

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

  const save = async () => {
    if (!diff || diff.invalid || changes === 0) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      load(await request<MapResponse>("PUT", diff.input).then((r) => ({ ...r, catalog: data?.catalog ?? [], gatewayConfigured: data?.gatewayConfigured ?? false })));
      setSaved(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  };

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

      {error && <p role="alert" className="text-xs font-bold text-red-600 px-3 py-2 rounded-lg bg-red-50 border border-red-100">{error}</p>}

      {!data && !error && (
        <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden /> Cargando…</p>
      )}

      {data && (
        <>
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
            {data.catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
                    className={inputClass}
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
                        className={inputClass}
                      />
                      <button
                        type="button"
                        onClick={() => setDraft(`p:${p.id}`, "")}
                        disabled={draft === ""}
                        aria-label={`Quitar el mapeo de ${p.name}`}
                        className="p-2 rounded-xl neumorphic-inset text-gray-500 disabled:opacity-40"
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
              onClick={save}
              disabled={busy || changes === 0 || diff?.invalid}
              className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl btn-glow text-white font-black text-sm disabled:opacity-50"
            >
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Save size={16} aria-hidden />}
              Guardar cambios{changes > 0 ? ` (${changes})` : ""}
            </button>
            {diff?.invalid && <p role="alert" className="text-xs font-bold text-red-600">Hay ids inválidos: tienen que ser números enteros.</p>}
            {saved && <p role="status" className="text-xs font-bold text-green-600">Mapeo guardado.</p>}
          </div>
        </>
      )}
    </div>
  );
}
