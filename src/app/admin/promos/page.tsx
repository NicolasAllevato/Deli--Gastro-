"use client";

import { useEffect, useState } from "react";
import { Lightbulb, Plus, Save, Tag, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/Switch";
import { DIAS_SEMANA, MAX_PROMOS, PROMO_CONFIG_KEY, parsePromos, promoListSchema, type Promo } from "@/lib/promos";

interface ProductOption { id: string; name: string; is_active: boolean }

const newPromo = (): Promo => ({
  id: crypto.randomUUID().slice(0, 12),
  tipo: "sugerencia",
  titulo: "",
  descripcion: "",
  productId: null,
  dias: [],
  activa: true,
});

const inputClass = "w-full rounded-2xl px-4 py-2.5 text-sm text-gray-800 bg-white border border-gray-300";

export default function PromosAdminPage() {
  const [promos, setPromos] = useState<Promo[] | null>(null);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/config", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error("config")))),
      fetch("/api/products", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error("productos")))),
    ])
      .then(([config, catalog]: [Record<string, unknown>, { products: ProductOption[] }]) => {
        setPromos(parsePromos(config[PROMO_CONFIG_KEY]));
        setProducts(catalog.products.filter((p) => p.is_active));
      })
      .catch(() => setError("No se pudo cargar la configuración."));
  }, []);

  const update = (id: string, patch: Partial<Promo>) => {
    setNotice(null);
    setPromos((prev) => (prev ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const toggleDay = (promo: Promo, day: number) =>
    update(promo.id, { dias: promo.dias.includes(day) ? promo.dias.filter((d) => d !== day) : [...promo.dias, day].sort() });

  const save = async () => {
    if (!promos) return;
    const parsed = promoListSchema.safeParse(promos);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Revisá los datos.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [PROMO_CONFIG_KEY]: parsed.data }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "No se pudo guardar.");
      setNotice("Guardado. Los clientes ya lo ven en el inicio.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-fade flex flex-col gap-4 p-2">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-headline text-2xl font-black text-gray-800">Sugerencias y promociones del día</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Lo que cargues acá aparece arriba del menú del cliente, en los días que elijas. Las promociones son
            informativas: el precio que se cobra es siempre el del producto en el catálogo.
          </p>
        </div>
        <button type="button" onClick={save} disabled={saving || !promos} className="btn-glow text-white rounded-full px-5 py-2.5 text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50">
          <Save size={16} aria-hidden /> {saving ? "Guardando..." : "Guardar"}
        </button>
      </header>

      {error && <p role="alert" className="text-xs font-bold text-red-600 px-3 py-2 rounded-lg bg-red-50 border border-red-100">{error}</p>}
      {notice && <p role="status" className="text-xs font-bold text-green-700 px-3 py-2 rounded-lg bg-green-50 border border-green-100">{notice}</p>}
      {!promos && !error && <div className="h-40 rounded-2xl shimmer" aria-hidden />}

      {promos && (
        <>
          {promos.length === 0 && (
            <p className="neumorphic-inset rounded-2xl p-6 text-sm text-gray-500 text-center">
              Todavía no hay nada cargado. Agregá una sugerencia del chef o la promo del día.
            </p>
          )}
          <ul className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {promos.map((promo) => (
              <li key={promo.id} className="neumorphic rounded-2xl p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <div role="group" aria-label="Tipo" className="inline-flex gap-1 rounded-full border border-gray-300 p-1">
                    {(["sugerencia", "promocion"] as const).map((tipo) => (
                      <button
                        key={tipo}
                        type="button"
                        aria-pressed={promo.tipo === tipo}
                        onClick={() => update(promo.id, { tipo })}
                        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-gray-600 aria-pressed:bg-brand-olive aria-pressed:text-white"
                      >
                        {tipo === "sugerencia" ? <Lightbulb size={13} aria-hidden /> : <Tag size={13} aria-hidden />}
                        {tipo === "sugerencia" ? "Sugerencia" : "Promoción"}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    aria-label={`Eliminar ${promo.titulo || "esta tarjeta"}`}
                    onClick={() => setPromos((prev) => (prev ?? []).filter((p) => p.id !== promo.id))}
                    className="p-2 rounded-xl text-gray-500 hover:text-red-500"
                  >
                    <Trash2 size={16} aria-hidden />
                  </button>
                </div>

                <label className="text-xs font-bold text-gray-600 uppercase tracking-widest">
                  Título
                  <input className={`${inputClass} mt-2 normal-case tracking-normal font-normal`} maxLength={60} value={promo.titulo} placeholder="Ej. 2x1 en pizzas grandes" onChange={(e) => update(promo.id, { titulo: e.target.value })} />
                </label>
                <label className="text-xs font-bold text-gray-600 uppercase tracking-widest">
                  Texto
                  <textarea className={`${inputClass} mt-2 normal-case tracking-normal font-normal`} rows={2} maxLength={160} value={promo.descripcion} placeholder="Ej. Solo hoy, pedí la segunda a mitad de precio" onChange={(e) => update(promo.id, { descripcion: e.target.value })} />
                </label>
                <label className="text-xs font-bold text-gray-600 uppercase tracking-widest">
                  Producto destacado (opcional)
                  <select className={`${inputClass} mt-2 normal-case tracking-normal`} value={promo.productId ?? ""} onChange={(e) => update(promo.id, { productId: e.target.value || null })}>
                    <option value="">Sin producto (solo el aviso)</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>

                <fieldset>
                  <legend className="text-xs font-bold text-gray-600 uppercase tracking-widest">Días</legend>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {DIAS_SEMANA.map((label, day) => (
                      <button
                        key={label}
                        type="button"
                        aria-pressed={promo.dias.includes(day)}
                        onClick={() => toggleDay(promo, day)}
                        className="rounded-full px-3 py-1.5 text-xs font-bold neumorphic text-gray-600 aria-pressed:bg-brand-olive aria-pressed:text-white"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-gray-500">{promo.dias.length === 0 ? "Sin días marcados: se muestra todos los días." : "Solo se muestra los días marcados."}</p>
                </fieldset>

                <Switch checked={promo.activa} onChange={(activa) => update(promo.id, { activa })} label="Activa" />
              </li>
            ))}
          </ul>

          <button
            type="button"
            disabled={promos.length >= MAX_PROMOS}
            onClick={() => setPromos((prev) => [...(prev ?? []), newPromo()])}
            className="self-start neumorphic neumorphic-hover rounded-full px-5 py-2.5 text-sm font-bold text-gray-700 inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Plus size={16} aria-hidden /> Agregar sugerencia o promoción
          </button>
        </>
      )}
    </div>
  );
}
