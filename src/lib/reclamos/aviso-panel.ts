/**
 * Aviso de reclamo nuevo en el panel (sonido + ventana emergente). Lógica pura: qué reclamos avisar y cómo
 * recordar los ya vistos en localStorage (con try/catch: modo privado o almacenamiento bloqueado no rompen nada).
 */
import { CATEGORIA_LABEL, type Categoria } from "./categoria.ts";

export interface ReclamoParaAviso {
  id: string;
  numero: number;
  categoria: Categoria;
  client_name: string | null;
  created_at: string;
}

export const SEEN_KEY = "reclamos-avisados";
/** Solo se avisan reclamos recientes: al abrir el panel horas después no salta un aviso por cada abierto viejo. */
export const AVISO_VENTANA_MS = 30 * 60 * 1000;
const MAX_SEEN = 100;

/** Reclamos a avisar: no vistos, de los últimos 30 min; el más viejo primero. */
export function reclamosPorAvisar(recientes: readonly ReclamoParaAviso[], vistos: ReadonlySet<string>, now: number = Date.now()): ReclamoParaAviso[] {
  return recientes
    .filter((r) => !vistos.has(r.id) && now - new Date(r.created_at).getTime() <= AVISO_VENTANA_MS)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function textoAviso(r: ReclamoParaAviso): string {
  return `Ingresó un reclamo #${r.numero} — ${CATEGORIA_LABEL[r.categoria] ?? r.categoria} — ${r.client_name ?? "Cliente sin nombre"}`;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function leerVistos(storage: StorageLike | null): Set<string> {
  try {
    const raw = storage?.getItem(SEEN_KEY);
    const value: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

/** Devuelve el conjunto nuevo (no muta el recibido) y lo guarda, recortado a los últimos 100. */
export function marcarVisto(storage: StorageLike | null, vistos: ReadonlySet<string>, id: string): Set<string> {
  const next = [...vistos.values(), id].filter((v, i, all) => all.indexOf(v) === i).slice(-MAX_SEEN);
  try {
    storage?.setItem(SEEN_KEY, JSON.stringify(next));
  } catch {
    /* sin almacenamiento: solo se recuerda en esta pestaña */
  }
  return new Set(next);
}
