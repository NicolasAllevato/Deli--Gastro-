"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Download, FileText, Plus, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { buttonClasses } from "@/lib/buttonClasses";
import { formatMoney } from "@/lib/orders";
import { ProductPicker, type PickerProduct } from "./ProductPicker";

interface ItemDraft {
  id: string;
  nombre: string;
  nota: string | null;
  producto_id: string | null;
  producto_id_2: string | null;
  activo: boolean;
}
interface SeccionDraft {
  id: string;
  titulo: string;
  columnas: string[];
  estilo: "lista" | "gustos";
  nota: string | null;
  activo: boolean;
  items: ItemDraft[];
}
interface AdminVista {
  secciones: SeccionDraft[];
  sinVincular: { id: string; nombre: string; precio: number; categoria: string | null }[];
}

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
const move = <T,>(list: readonly T[], from: number, to: number): T[] => {
  if (to < 0 || to >= list.length) return [...list];
  const copy = [...list];
  const [it] = copy.splice(from, 1);
  copy.splice(to, 0, it);
  return copy;
};
const toDraft = (v: AdminVista): SeccionDraft[] =>
  v.secciones.map((s) => ({
    id: s.id, titulo: s.titulo, columnas: s.columnas, estilo: s.estilo, nota: s.nota, activo: s.activo,
    items: s.items.map((i) => ({ id: i.id, nombre: i.nombre, nota: i.nota, producto_id: i.producto_id, producto_id_2: i.producto_id_2, activo: i.activo })),
  }));

async function fetchCarta(): Promise<AdminVista> {
  const res = await fetch("/api/admin/carta", { cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as AdminVista & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "No se pudo cargar la carta.");
  return json;
}

const inputClass = "w-full rounded-lg neumorphic-inset px-2 py-1.5 text-xs text-gray-800";

/** Editor de la carta estructurada: secciones, líneas, productos vinculados, vista previa del PDF y descarga. */
export function CartaEstructurada({ products }: { products: readonly PickerProduct[] }) {
  const [secciones, setSecciones] = useState<SeccionDraft[]>([]);
  const [sinVincular, setSinVincular] = useState<AdminVista["sinVincular"]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [version, setVersion] = useState(() => Date.now());

  const apply = (v: AdminVista) => {
    setSecciones(toDraft(v));
    setSinVincular(v.sinVincular);
    setDirty(false);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      apply(await fetchCarta());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la carta.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    fetchCarta()
      .then((v) => alive && apply(v))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "No se pudo cargar la carta."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const edit = (next: SeccionDraft[]) => {
    setSecciones(next);
    setDirty(true);
    setNotice(null);
  };
  const editSeccion = (si: number, patch: Partial<SeccionDraft>) => edit(secciones.map((s, i) => (i === si ? { ...s, ...patch } : s)));
  const editItem = (si: number, ii: number, patch: Partial<ItemDraft>) =>
    editSeccion(si, { items: secciones[si].items.map((it, i) => (i === ii ? { ...it, ...patch } : it)) });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/carta", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secciones }),
      });
      const json = (await res.json().catch(() => ({}))) as AdminVista & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "No se pudo guardar la carta.");
      apply(json);
      setVersion(Date.now());
      setNotice("Carta guardada. El PDF, el portal y el bot ya usan esta versión.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la carta.");
    } finally {
      setSaving(false);
    }
  };

  const pdfUrl = `/api/public/carta.pdf?v=${version}`;

  return (
    <section className="space-y-4" aria-labelledby="carta-estructurada-titulo">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="carta-estructurada-titulo" className="flex items-center gap-2 font-bold text-sm text-gray-800">
            <FileText size={16} aria-hidden /> Carta impresa (PDF)
          </h2>
          <p className="text-xs text-gray-500">Secciones y líneas como en la carta del local. Los precios salen siempre de los productos (Fudo).</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => void load()} disabled={loading || saving} leftIcon={<RefreshCw size={14} aria-hidden />}>Recargar</Button>
          <a href={`${pdfUrl}&descargar=1`} className={buttonClasses("secondary", "sm")}><Download size={14} aria-hidden /> Descargar PDF</a>
          <Button size="sm" onClick={() => void save()} loading={saving} disabled={!dirty || loading}>Guardar carta</Button>
        </div>
      </div>

      {error && <p role="alert" className="text-xs font-bold text-red-600 px-3 py-2 rounded-lg bg-red-50 border border-red-100">{error}</p>}
      {notice && <p role="status" className="text-xs font-bold text-emerald-700 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100">{notice}</p>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          {loading && <p className="text-xs text-gray-500">Cargando carta…</p>}
          {!loading && secciones.length === 0 && (
            <p className="text-xs text-gray-500 neumorphic rounded-2xl p-4">Todavía no hay carta armada: el PDF sale por categorías. Agregá una sección para empezar.</p>
          )}
          {secciones.map((s, si) => (
            <article key={s.id} className="neumorphic rounded-2xl p-4 space-y-3" aria-label={`Sección ${s.titulo}`}>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Título
                  <input className={inputClass} value={s.titulo} maxLength={80} onChange={(e) => editSeccion(si, { titulo: e.target.value })} />
                </label>
                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Columnas de precio (separadas por coma)
                  <input
                    className={inputClass}
                    value={s.columnas.join(", ")}
                    placeholder="8 porciones, Porción"
                    onChange={(e) => editSeccion(si, { columnas: e.target.value.split(",").map((c) => c.trim()).filter(Boolean).slice(0, 2) })}
                  />
                </label>
                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Formato
                  <select className={inputClass} value={s.estilo} onChange={(e) => editSeccion(si, { estilo: e.target.value === "gustos" ? "gustos" : "lista" })}>
                    <option value="lista">Lista con precios</option>
                    <option value="gustos">Precio único + gustos</option>
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <input className={`${inputClass} flex-1 min-w-[12rem]`} aria-label={`Nota de la sección ${s.titulo}`} placeholder="Nota de la sección (opcional)" value={s.nota ?? ""} maxLength={200} onChange={(e) => editSeccion(si, { nota: e.target.value })} />
                <Switch checked={s.activo} onChange={(v) => editSeccion(si, { activo: v })} label="Activa" />
                <Button size="sm" variant="icon" aria-label={`Subir sección ${s.titulo}`} onClick={() => edit(move(secciones, si, si - 1))}><ArrowUp size={14} aria-hidden /></Button>
                <Button size="sm" variant="icon" aria-label={`Bajar sección ${s.titulo}`} onClick={() => edit(move(secciones, si, si + 1))}><ArrowDown size={14} aria-hidden /></Button>
                <Button size="sm" variant="icon" aria-label={`Borrar sección ${s.titulo}`} onClick={() => edit(secciones.filter((_, i) => i !== si))}><Trash2 size={14} aria-hidden /></Button>
              </div>

              <ul className="space-y-2">
                {s.items.map((it, ii) => (
                  <li key={it.id} className={`rounded-xl neumorphic-inset p-3 space-y-2 ${it.activo ? "" : "opacity-60"}`}>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input className={inputClass} aria-label="Nombre en la carta" value={it.nombre} maxLength={80} onChange={(e) => editItem(si, ii, { nombre: e.target.value })} />
                      <input className={inputClass} aria-label={`Nota de ${it.nombre}`} placeholder="Nota (opcional)" value={it.nota ?? ""} maxLength={120} onChange={(e) => editItem(si, ii, { nota: e.target.value })} />
                    </div>
                    <div className={`grid gap-2 ${s.columnas.length >= 2 ? "sm:grid-cols-2" : ""}`}>
                      <ProductPicker label={s.columnas[0] ?? "Producto (precio)"} value={it.producto_id} products={products} onChange={(v) => editItem(si, ii, { producto_id: v })} />
                      {s.columnas.length >= 2 && (
                        <ProductPicker label={s.columnas[1]} value={it.producto_id_2} products={products} onChange={(v) => editItem(si, ii, { producto_id_2: v })} />
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {!it.producto_id && <span className="text-[11px] font-bold text-amber-700 flex items-center gap-1"><TriangleAlert size={12} aria-hidden /> Sin producto: sale sin precio</span>}
                      <span className="flex-1" />
                      <Switch checked={it.activo} onChange={(v) => editItem(si, ii, { activo: v })} aria-label={`Línea ${it.nombre} activa`} />
                      <Button size="sm" variant="icon" aria-label={`Subir ${it.nombre}`} onClick={() => editSeccion(si, { items: move(s.items, ii, ii - 1) })}><ArrowUp size={14} aria-hidden /></Button>
                      <Button size="sm" variant="icon" aria-label={`Bajar ${it.nombre}`} onClick={() => editSeccion(si, { items: move(s.items, ii, ii + 1) })}><ArrowDown size={14} aria-hidden /></Button>
                      <Button size="sm" variant="icon" aria-label={`Borrar ${it.nombre}`} onClick={() => editSeccion(si, { items: s.items.filter((_, i) => i !== ii) })}><Trash2 size={14} aria-hidden /></Button>
                    </div>
                  </li>
                ))}
              </ul>
              <Button size="sm" variant="secondary" leftIcon={<Plus size={14} aria-hidden />} onClick={() => editSeccion(si, { items: [...s.items, { id: newId("item"), nombre: "Nueva línea", nota: null, producto_id: null, producto_id_2: null, activo: true }] })}>
                Agregar línea
              </Button>
            </article>
          ))}
          <Button size="sm" variant="secondary" leftIcon={<Plus size={14} aria-hidden />} onClick={() => edit([...secciones, { id: newId("sec"), titulo: "Nueva sección", columnas: [], estilo: "lista", nota: null, activo: true, items: [] }])}>
            Agregar sección
          </Button>

          {sinVincular.length > 0 && (
            <div className="neumorphic rounded-2xl p-4 space-y-2" role="region" aria-label="Productos fuera de la carta">
              <h3 className="flex items-center gap-2 text-xs font-bold text-amber-700"><TriangleAlert size={14} aria-hidden /> {sinVincular.length} producto(s) visibles en el portal que no están en la carta</h3>
              <ul className="grid gap-1 sm:grid-cols-2 text-xs text-gray-600">
                {sinVincular.map((p) => <li key={p.id}>{p.nombre} · {formatMoney(p.precio)}{p.categoria ? ` · ${p.categoria}` : ""}</li>)}
              </ul>
            </div>
          )}
        </div>

        <aside className="neumorphic rounded-2xl p-3 space-y-2 xl:sticky xl:top-4 self-start">
          <p className="text-xs font-bold text-gray-700">Vista previa {dirty && <span className="text-amber-700">(guardá para ver los cambios)</span>}</p>
          <iframe key={version} src={pdfUrl} title="Vista previa de la carta en PDF" className="w-full h-[70vh] rounded-xl bg-white" />
        </aside>
      </div>
    </section>
  );
}
