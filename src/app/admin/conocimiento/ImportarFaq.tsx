"use client";

import { useRef, useState } from "react";
import { Download, FileUp } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { MAX_FAQ_FILE_BYTES } from "@/lib/kb/faq-file";
import { oneLine } from "@/lib/kb/errores-view";

const URL = "/api/admin/conocimiento/importar";
const ACCEPT = ".txt,.md,.csv,text/plain,text/markdown,text/csv";

interface PreviewItem {
  indice: number;
  tema: string;
  contenido: string;
  palabras_clave: string;
  line: number;
  duplicado: { id: string; categoria: string; tema: string } | null;
  repetido: boolean;
}

interface Issue {
  line: number;
  message: string;
}

interface Preview {
  items: PreviewItem[];
  errores: Issue[];
  avisos: Issue[];
  existentes: number;
  limite: number;
}

interface SaveResult {
  insertadas: number;
  reemplazadas: number;
  salteadas: number;
}

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch(URL, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "No se pudo completar la operación.");
  return json;
}

const message = (e: unknown) => (e instanceof Error ? e.message : "No se pudo completar la operación.");

/** Marcadas de entrada: las nuevas; los duplicados solo si se pidió reemplazar. */
const defaultSelection = (items: readonly PreviewItem[]): Set<number> => new Set(items.filter((i) => !i.duplicado && !i.repetido).map((i) => i.indice));

/** Carga de preguntas frecuentes desde un archivo: vista previa con duplicados marcados y guardado de las elegidas. */
export function ImportarFaq({ onSaved }: { onSaved: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ nombre: string; texto: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [reemplazar, setReemplazar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setSelected(new Set());
    setReemplazar(false);
  }

  async function choose(picked: File | undefined) {
    if (!picked) return;
    setError(null);
    setNotice(null);
    reset();
    if (picked.size > MAX_FAQ_FILE_BYTES) {
      setError(`El archivo pesa más de ${MAX_FAQ_FILE_BYTES / 1024} KB.`);
      return;
    }
    setBusy(true);
    try {
      const texto = await picked.text();
      const loaded = await post<Preview>({ modo: "preview", nombre: picked.name, texto });
      setFile({ nombre: picked.name, texto });
      setPreview(loaded);
      setSelected(defaultSelection(loaded.items));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      // Permite volver a elegir el mismo archivo después de corregirlo.
      if (input.current) input.current.value = "";
    }
  }

  function toggle(indice: number, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(indice);
      else next.delete(indice);
      return next;
    });
  }

  function changeReplace(on: boolean) {
    setReemplazar(on);
    // Al apagarlo, los duplicados que estaban marcados se desmarcan (se saltearían igual).
    if (!on && preview) setSelected((prev) => new Set([...prev].filter((i) => !preview.items[i]?.duplicado)));
  }

  async function save() {
    if (!file || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const done = await post<SaveResult>({ modo: "guardar", nombre: file.nombre, texto: file.texto, seleccion: [...selected].sort((a, b) => a - b), reemplazar });
      const parts = [`${done.insertadas} ${done.insertadas === 1 ? "pregunta agregada" : "preguntas agregadas"}`];
      if (done.reemplazadas) parts.push(`${done.reemplazadas} ${done.reemplazadas === 1 ? "reemplazada" : "reemplazadas"}`);
      if (done.salteadas) parts.push(`${done.salteadas} salteadas`);
      setNotice(`${parts.join(", ")}.`);
      reset();
      onSaved();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const newCount = preview ? [...selected].filter((i) => !preview.items[i]?.duplicado).length : 0;
  const overLimit = preview ? preview.existentes + newCount > preview.limite : false;

  return (
    <section className="neumorphic rounded-2xl p-5 space-y-4" aria-label="Cargar preguntas frecuentes desde un archivo">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-headline font-bold text-sm uppercase tracking-widest text-gray-700 flex-1">Preguntas frecuentes por archivo</h2>
        <a
          href="/modelos/faq-modelo.txt"
          download
          className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-600 hover:text-brand-orange"
        >
          <Download size={14} aria-hidden /> Descargar modelo
        </a>
        <input ref={input} type="file" accept={ACCEPT} className="sr-only" aria-label="Archivo de preguntas frecuentes" tabIndex={-1} onChange={(e) => void choose(e.target.files?.[0])} />
        <Button size="sm" variant="secondary" loading={busy && !preview} leftIcon={<FileUp size={14} aria-hidden />} onClick={() => input.current?.click()}>
          Cargar archivo de preguntas frecuentes
        </Button>
      </div>
      <p className="text-xs text-gray-500">
        Aceptamos .txt, .md y .csv de hasta {MAX_FAQ_FILE_BYTES / 1024} KB. En texto: «P: pregunta» y «R: respuesta» separadas por una línea en blanco. En csv: columnas pregunta, respuesta y, si querés, palabras_clave.
      </p>

      {error && <p role="alert" className="text-xs font-bold text-red-600">{error}</p>}
      {notice && <p role="status" className="text-xs font-bold text-green-700">{notice}</p>}

      {preview && file && (
        <div className="space-y-3">
          <p className="text-xs font-bold text-gray-700">
            {file.nombre}: {preview.items.length} {preview.items.length === 1 ? "pregunta leída" : "preguntas leídas"}
            {preview.items.some((i) => i.duplicado) && `, ${preview.items.filter((i) => i.duplicado).length} ya existen`}.
          </p>

          {preview.errores.length > 0 && (
            <ul role="alert" className="space-y-1 text-xs text-red-600">
              {preview.errores.map((e, i) => <li key={`${e.line}-${i}`}>Línea {e.line}: {e.message}</li>)}
            </ul>
          )}
          {preview.avisos.length > 0 && (
            <ul className="space-y-1 text-xs text-yellow-800">
              {preview.avisos.map((a, i) => <li key={`${a.line}-${i}`}>Línea {a.line}: {a.message}</li>)}
            </ul>
          )}

          {preview.items.length > 0 && (
            <>
              <Switch checked={reemplazar} onChange={changeReplace} label="Reemplazar las que ya existen" hint="Si la apagás, las preguntas repetidas se saltean y no se toca lo ya cargado." />
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setSelected(new Set(preview.items.filter((i) => !i.repetido && (reemplazar || !i.duplicado)).map((i) => i.indice)))}>
                  Marcar todas
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setSelected(new Set())}>Desmarcar todas</Button>
              </div>
              <ul className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
                {preview.items.map((item) => {
                  const blocked = item.repetido || (!!item.duplicado && !reemplazar);
                  const id = `faq-${item.indice}`;
                  return (
                    <li key={item.indice} className="neumorphic-inset rounded-xl p-3 flex gap-3 items-start">
                      <input
                        id={id}
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-brand-orange"
                        checked={selected.has(item.indice)}
                        disabled={blocked || busy}
                        onChange={(e) => toggle(item.indice, e.target.checked)}
                      />
                      <label htmlFor={id} className="flex-1 min-w-0 cursor-pointer">
                        <span className="block text-sm font-bold text-gray-800">{item.tema}</span>
                        <span className="block text-xs text-gray-600 whitespace-pre-wrap">{oneLine(item.contenido, 220)}</span>
                        {item.palabras_clave && <span className="block text-xs text-gray-500 mt-1">Palabras clave: {item.palabras_clave}</span>}
                        {item.duplicado && (
                          <span className="badge-yellow mt-1 inline-block">Ya existe: «{oneLine(item.duplicado.tema, 50)}» ({item.duplicado.categoria})</span>
                        )}
                        {item.repetido && <span className="badge-red mt-1 inline-block">Repetida en el archivo: se saltea</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>
              {overLimit && (
                <p role="alert" className="text-xs font-bold text-yellow-800 px-3 py-2 rounded-lg bg-yellow-50 border border-yellow-200">
                  Hay {preview.existentes} entradas cargadas y el tope es {preview.limite}: no entran {newCount} nuevas. Desmarcá algunas o borrá las que no uses.
                </p>
              )}
            </>
          )}

          <div className="flex gap-2">
            <Button size="sm" onClick={() => void save()} loading={busy} disabled={selected.size === 0 || overLimit}>
              Guardar {selected.size} {selected.size === 1 ? "pregunta" : "preguntas"}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={reset}>Cancelar</Button>
          </div>
        </div>
      )}
    </section>
  );
}
