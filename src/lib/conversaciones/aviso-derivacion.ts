/**
 * Aviso de conversación derivada a una persona (banner + notificación de escritorio + sonido).
 * Lógica pura: qué derivaciones avisar y cómo recordar las ya vistas en localStorage
 * (con try/catch: modo privado o almacenamiento bloqueado no rompen nada).
 *
 * La derivación se identifica por el id de la conversación mientras siga derivada: al volver el bot a
 * atender, la conversación sale de la lista, `podarVistos` la olvida y una derivación futura avisa de nuevo.
 */

export interface DerivacionAviso {
  id: string;
  /** Nombre del cliente; nunca el teléfono completo. */
  nombre: string;
  /** Desde cuándo está derivada (ISO). */
  desde: string;
  /** Último mensaje, ya recortado. */
  ultimoMensaje: string;
}

export const SEEN_KEY = "derivaciones-avisadas";
export const MAX_TEXTO = 80;
const MAX_SEEN = 100;

/** No vistas, la más vieja primero. */
export function derivacionesPorAvisar(derivadas: readonly DerivacionAviso[], vistos: ReadonlySet<string>): DerivacionAviso[] {
  return derivadas.filter((x) => !vistos.has(x.id)).sort((a, b) => a.desde.localeCompare(b.desde));
}

/** Solo conserva los vistos que siguen derivados. No muta el conjunto recibido. */
export function podarVistos(vistos: ReadonlySet<string>, derivadas: readonly DerivacionAviso[]): Set<string> {
  const activos = new Set(derivadas.map((x) => x.id));
  return new Set([...vistos].filter((id) => activos.has(id)));
}

export function recortarTexto(texto: string | null | undefined, max: number = MAX_TEXTO): string {
  const limpio = (texto ?? "").replace(/\s+/g, " ").trim();
  return limpio.length <= max ? limpio : `${limpio.slice(0, max - 1)}…`;
}

/** Nombre para mostrar: si no hay nombre real (o es un teléfono) deja solo las últimas 4 cifras. */
export function nombreSeguro(nombre: string | null | undefined, telefono: string | null | undefined): string {
  const limpio = (nombre ?? "").trim();
  if (limpio && !/^[+\d\s()-]{7,}$/.test(limpio)) return limpio;
  const digitos = (limpio || telefono || "").replace(/\D/g, "");
  return digitos.length >= 4 ? `Cliente ***${digitos.slice(-4)}` : "Cliente sin nombre";
}

export function textoNotificacion(d: DerivacionAviso): string {
  return d.ultimoMensaje ? `${d.nombre}: ${d.ultimoMensaje}` : `${d.nombre} pasó a atención humana`;
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

export function guardarVistos(storage: StorageLike | null, vistos: ReadonlySet<string>): void {
  try {
    storage?.setItem(SEEN_KEY, JSON.stringify([...vistos].slice(-MAX_SEEN)));
  } catch {
    /* sin almacenamiento: solo se recuerda en esta pestaña */
  }
}
