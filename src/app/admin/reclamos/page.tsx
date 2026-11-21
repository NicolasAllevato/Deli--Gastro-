"use client";

import { useEffect, useState } from "react";
import { MessageSquareWarning } from "lucide-react";
import { formatDateTimeAR } from "@/lib/time-ar";
import { CATEGORIA_LABEL, CATEGORIAS, esConsulta, textoConsulta, type Categoria } from "@/lib/reclamos/categoria";
import { ReclamoDetalle } from "./ReclamoDetalle";
import { ESTADO_BADGE, ESTADO_LABEL, call, type Estado, type ReclamoItem } from "./shared";

interface Filtros {
  estado: Estado | "";
  categoria: Categoria | "";
  desde: string;
  hasta: string;
}

const fecha = (iso: string) => formatDateTimeAR(iso, { dateStyle: "short", timeStyle: "short" });
const selectClass = "neumorphic-inset rounded-xl px-3 py-2 text-sm text-gray-800 bg-transparent";

/** Reclamos de clientes: lista con filtros, conteo por categoría (30 días) y detalle con acciones. */
const ESTADOS: readonly string[] = ["abierto", "en_curso", "resuelto"];

/** Deep link desde el mail (?id=…) o desde el aviso del panel (?estado=abierto). */
function queryParam(name: string): string | null {
  return typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(name);
}

export default function ReclamosPage() {
  const [filtros, setFiltros] = useState<Filtros>(() => {
    const estado = queryParam("estado") ?? "";
    return { estado: (ESTADOS.includes(estado) ? estado : "") as Filtros["estado"], categoria: "", desde: "", hasta: "" };
  });
  const [items, setItems] = useState<ReclamoItem[] | null>(null);
  const [porCategoria, setPorCategoria] = useState<Record<Categoria, number> | null>(null);
  const [entrenamiento, setEntrenamiento] = useState(false);
  const [selected, setSelected] = useState<string | null>(() => queryParam("id"));
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const qs = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v !== ""));
    call<{ reclamos: ReclamoItem[]; porCategoria: Record<Categoria, number>; modoEntrenamiento?: boolean }>(`/api/admin/reclamos?${qs}`)
      .then((data) => {
        if (!alive) return;
        setItems(data.reclamos);
        setPorCategoria(data.porCategoria);
        setEntrenamiento(data.modoEntrenamiento === true);
        setError(null);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "No se pudo cargar.");
      });
    return () => {
      alive = false;
    };
  }, [filtros, version]);

  const set = <K extends keyof Filtros>(key: K, value: Filtros[K]) => setFiltros((f) => ({ ...f, [key]: value }));

  return (
    <div className="space-y-4 p-1">
      <header className="neumorphic rounded-2xl p-5 space-y-3">
        <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
          <MessageSquareWarning size={20} aria-hidden className="text-brand-orange" /> Reclamos
        </h2>
        <p className="text-xs text-gray-500">Últimos 30 días por categoría</p>
        <ul className="flex flex-wrap gap-2" aria-label="Reclamos por categoría, últimos 30 días">
          {CATEGORIAS.map((c) => (
            <li key={c}>
              <button
                type="button"
                onClick={() => set("categoria", filtros.categoria === c ? "" : c)}
                aria-pressed={filtros.categoria === c}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold ${filtros.categoria === c ? "neumorphic-inset text-brand-orange" : "neumorphic text-gray-600"}`}
              >
                {CATEGORIA_LABEL[c]} · {porCategoria?.[c] ?? "–"}
              </button>
            </li>
          ))}
        </ul>
      </header>

      {entrenamiento && (
        <p role="status" className="neumorphic rounded-2xl px-4 py-3 text-sm font-bold text-brand-orange">
          Modo entrenamiento activo: los reclamos no se derivan
        </p>
      )}

      <section className="neumorphic rounded-2xl p-4 flex flex-wrap gap-3 items-end" aria-label="Filtros">
        <label className="text-xs text-gray-500 flex flex-col gap-1">
          Estado
          <select className={selectClass} value={filtros.estado} onChange={(e) => set("estado", e.target.value as Filtros["estado"])}>
            <option value="">Todos</option>
            {(Object.keys(ESTADO_LABEL) as Estado[]).map((e) => (
              <option key={e} value={e}>{ESTADO_LABEL[e]}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-500 flex flex-col gap-1">
          Categoría
          <select className={selectClass} value={filtros.categoria} onChange={(e) => set("categoria", e.target.value as Filtros["categoria"])}>
            <option value="">Todas</option>
            {CATEGORIAS.map((c) => (
              <option key={c} value={c}>{CATEGORIA_LABEL[c]}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-500 flex flex-col gap-1">
          Desde
          <input type="date" className={selectClass} value={filtros.desde} onChange={(e) => set("desde", e.target.value)} />
        </label>
        <label className="text-xs text-gray-500 flex flex-col gap-1">
          Hasta
          <input type="date" className={selectClass} value={filtros.hasta} onChange={(e) => set("hasta", e.target.value)} />
        </label>
      </section>

      {error && <p role="alert" className="text-sm font-bold text-red-600">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section aria-label="Lista de reclamos" className="space-y-2">
          {items === null && !error && <p className="text-sm text-gray-500">Cargando...</p>}
          {items?.length === 0 && <p className="text-sm text-gray-500">No hay reclamos con estos filtros.</p>}
          {items?.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelected(r.id)}
              aria-current={selected === r.id}
              className={`w-full text-left rounded-xl p-3 space-y-1 ${selected === r.id ? "neumorphic-inset" : "neumorphic neumorphic-hover"}`}
            >
              <p className="text-xs text-gray-500 flex flex-wrap gap-2 items-center">
                <span className="font-bold text-gray-800">#{r.numero}</span>
                <span className={ESTADO_BADGE[r.estado]}>{ESTADO_LABEL[r.estado]}</span>
                {esConsulta(r) ? <span className="badge-blue">Consulta</span> : <span>{CATEGORIA_LABEL[r.categoria]}</span>}
                <span>· {fecha(r.created_at)}</span>
                {r.foto_keys.length > 0 && <span>· {r.foto_keys.length} foto(s)</span>}
              </p>
              <p className="text-sm text-gray-800 line-clamp-2">{esConsulta(r) ? textoConsulta(r.motivo) : r.motivo}</p>
              <p className="text-xs text-gray-500">{r.client_name ?? "Sin nombre"} · {r.client_phone}</p>
            </button>
          ))}
        </section>
        <section aria-label="Detalle del reclamo">
          {selected ? (
            <ReclamoDetalle id={selected} onChanged={() => setVersion((v) => v + 1)} />
          ) : (
            <p className="text-sm text-gray-500 p-4">Elegí un reclamo para ver el detalle.</p>
          )}
        </section>
      </div>
    </div>
  );
}
