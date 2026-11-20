"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Switch } from "@/components/ui/Switch";
import { Aprendizaje } from "./Aprendizaje";
import { ImportarFaq } from "./ImportarFaq";
import { Reclamos } from "./Reclamos";

type Categoria = "faq" | "politica" | "promo" | "vocabulario" | "otro";

interface Entry {
  id: string;
  categoria: Categoria;
  tema: string;
  contenido: string;
  palabras_clave: string;
  activo: boolean;
  orden: number;
}

type Draft = Omit<Entry, "id"> & { id?: string };

const CATEGORIAS: { value: Categoria; label: string; hint: string }[] = [
  { value: "faq", label: "Preguntas frecuentes", hint: "Tema: la pregunta. Contenido: la respuesta que tiene que dar." },
  { value: "politica", label: "Políticas", hint: "Cambios, demoras, reclamos, alérgenos, etc." },
  { value: "promo", label: "Promos", hint: "Qué incluye, días y condiciones." },
  { value: "vocabulario", label: "Vocabulario", hint: "Tema: cómo lo dice el cliente (\"la napo\"). Contenido: a qué se refiere." },
  { value: "otro", label: "Otros", hint: "Cualquier dato del local que el agente deba saber." },
];

const EMPTY: Draft = { categoria: "faq", tema: "", contenido: "", palabras_clave: "", activo: true, orden: 0 };

/** Tope que usa el servidor si todavía no respondió (se pisa con el valor real). */
const DEFAULT_LIMIT = 300;

async function request<T>(method: string, body?: unknown): Promise<T> {
  const res = await fetch("/api/admin/conocimiento", {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "No se pudo completar la operación.");
  return json;
}

const message = (e: unknown) => (e instanceof Error ? e.message : "No se pudo completar la operación.");

export default function ConocimientoPage() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const loaded = await request<{ entries: Entry[]; limit?: number }>("GET");
      setEntries(loaded.entries);
      if (loaded.limit) setLimit(loaded.limit);
    } catch (e) {
      setError(message(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(
    () => CATEGORIAS.map((c) => ({ ...c, items: (entries ?? []).filter((e) => e.categoria === c.value) })),
    [entries],
  );

  async function run(action: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(ok);
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const { id, ...fields } = draft;
    void run(async () => {
      await request(id ? "PATCH" : "POST", id ? { id, ...fields } : fields);
      setDraft(EMPTY);
    }, id ? "Cambios guardados." : "Entrada agregada.");
  }

  const hint = CATEGORIAS.find((c) => c.value === draft.categoria)?.hint;
  const activeCount = (entries ?? []).filter((e) => e.activo).length;
  const atLimit = (entries?.length ?? 0) >= limit;

  return (
    <div className="space-y-5 max-w-3xl mx-auto pb-10">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full neumorphic flex items-center justify-center text-brand-orange">
          <BookOpen size={20} aria-hidden />
        </div>
        <div>
          <h1 className="font-headline font-black text-xl text-gray-800 tracking-tight">Conocimiento del agente</h1>
          <p className="text-gray-500 text-xs mt-0.5 font-medium">
            Lo que el agente de WhatsApp sabe del local. Los precios y el menú los toma siempre de Productos.
          </p>
        </div>
      </div>

      {error && <p role="alert" className="text-xs font-bold text-red-600 px-3 py-2 rounded-lg bg-red-50 border border-red-100">{error}</p>}
      {notice && <p role="status" className="text-xs font-bold text-green-700 px-3 py-2 rounded-lg bg-green-50 border border-green-100">{notice}</p>}

      <section className="neumorphic rounded-2xl p-5 space-y-4" aria-label={draft.id ? "Editar entrada" : "Nueva entrada"}>
        <h2 className="font-headline font-bold text-sm uppercase tracking-widest text-gray-700">{draft.id ? "Editar entrada" : "Nueva entrada"}</h2>
        <label className="block text-xs font-bold text-gray-600">
          Categoría
          <select
            value={draft.categoria}
            onChange={(e) => setDraft({ ...draft, categoria: e.target.value as Categoria })}
            className="mt-1 w-full px-4 py-3 rounded-xl neumorphic-inset text-sm text-gray-700 outline-none focus:ring-2 focus:ring-brand-orange/40"
          >
            {CATEGORIAS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <Field label="Tema" value={draft.tema} maxLength={120} onChange={(e) => setDraft({ ...draft, tema: e.target.value })} hint={hint} />
        <Field as="textarea" rows={3} label="Contenido" value={draft.contenido} maxLength={1000} onChange={(e) => setDraft({ ...draft, contenido: e.target.value })} />
        <Field
          label="Palabras clave (opcional)"
          value={draft.palabras_clave}
          maxLength={300}
          onChange={(e) => setDraft({ ...draft, palabras_clave: e.target.value })}
          hint="Otras formas en que te lo preguntan, separadas por coma (ej.: abren, cierran, hora). Ayudan al agente a encontrar esta entrada."
        />
        <Switch checked={draft.activo} onChange={(activo) => setDraft({ ...draft, activo })} label="Activa" hint="Si la apagás, el agente deja de usarla." />
        <div className="flex gap-2">
          <Button size="sm" onClick={save} loading={busy} disabled={!draft.tema.trim() || !draft.contenido.trim()}>
            {draft.id ? "Guardar cambios" : "Agregar"}
          </Button>
          {draft.id && <Button size="sm" variant="secondary" onClick={() => setDraft(EMPTY)}>Cancelar</Button>}
        </div>
      </section>

      <ImportarFaq onSaved={() => void load()} />

      <Reclamos />
      <Aprendizaje onApproved={() => void load()} />

      {entries !== null && (
        <p className="text-xs font-bold text-gray-600" role="status">
          {activeCount} {activeCount === 1 ? "entrada activa" : "entradas activas"} de {entries.length} cargadas
        </p>
      )}
      {atLimit && (
        <p role="alert" className="text-xs font-bold text-yellow-800 px-3 py-2 rounded-lg bg-yellow-50 border border-yellow-200">
          Llegaste al tope de {limit} entradas: las que superen ese número no se muestran acá. Borrá o unificá las que no uses antes de cargar más.
        </p>
      )}
      {entries === null && !error && <p className="text-sm text-gray-500">Cargando...</p>}
      {entries?.length === 0 && <p className="text-sm text-gray-500">Todavía no cargaste nada. Empezá por las preguntas que más te hacen.</p>}

      {grouped.filter((g) => g.items.length > 0).map((g) => (
        <section key={g.value} className="neumorphic rounded-2xl p-5 space-y-3" aria-label={g.label}>
          <h2 className="font-headline font-bold text-sm uppercase tracking-widest text-gray-700">{g.label}</h2>
          <ul className="space-y-2">
            {g.items.map((e) => (
              <li key={e.id} className="neumorphic-inset rounded-xl p-3 flex gap-3 items-start">
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-bold ${e.activo ? "text-gray-800" : "text-gray-500 line-through"}`}>{e.tema}</p>
                  <p className="text-xs text-gray-600 whitespace-pre-wrap mt-1">{e.contenido}</p>
                  {e.palabras_clave && <p className="text-xs text-gray-500 mt-1">Palabras clave: {e.palabras_clave}</p>}
                </div>
                <Switch
                  checked={e.activo}
                  disabled={busy}
                  onChange={(activo) => void run(() => request("PATCH", { id: e.id, activo }), activo ? "Entrada activada." : "Entrada desactivada.")}
                  label={`Activa: ${e.tema}`}
                />
                <button type="button" aria-label={`Editar ${e.tema}`} className="p-2 rounded-lg text-gray-600 hover:text-brand-orange" onClick={() => setDraft(e)}>
                  <Pencil size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`Borrar ${e.tema}`}
                  disabled={busy}
                  className="p-2 rounded-lg text-gray-600 hover:text-red-600"
                  onClick={() => void run(() => request("DELETE", { id: e.id }), "Entrada borrada.")}
                >
                  <Trash2 size={16} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
