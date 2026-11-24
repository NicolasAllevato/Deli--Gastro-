/** Notificaciones de la campana del panel: armado, orden, recorte y conteo de no vistas. Lógica pura. */

export type NotificacionTipo = "pedido" | "derivacion" | "reclamo" | "habilitacion";

export interface Notificacion {
  id: string;
  tipo: NotificacionTipo;
  titulo: string;
  detalle: string;
  /** ISO 8601. */
  fecha: string;
  href: string;
}

export interface NotificacionesRespuesta {
  items: Notificacion[];
  total: number;
}

export const MAX_NOTIFICACIONES = 30;
const MAX_MOTIVO = 80;

const pesos = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export function recortar(texto: string | null | undefined, max: number): string {
  const limpio = (texto ?? "").replace(/\s+/g, " ").trim();
  return limpio.length <= max ? limpio : `${limpio.slice(0, max - 1)}…`;
}

const tiempo = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

export interface PedidoFuente {
  id: string;
  clientName: string | null;
  /** Total en pesos. */
  total: number;
  createdAt: string;
}

export function dePedido(p: PedidoFuente): Notificacion {
  const cliente = (p.clientName ?? "").trim() || "Cliente";
  return {
    id: `pedido-${p.id}`,
    tipo: "pedido",
    titulo: `Pedido nuevo #${p.id.slice(0, 8).toUpperCase()}`,
    detalle: `${cliente} · ${pesos.format(p.total).replace(/\s/g, "")}`,
    fecha: p.createdAt,
    href: "/admin/tablero",
  };
}

export interface DerivacionFuente {
  id: string;
  nombre: string;
  ultimoMensaje: string;
  desde: string;
}

export function deDerivacion(d: DerivacionFuente): Notificacion {
  return {
    id: `derivacion-${d.id}`,
    tipo: "derivacion",
    titulo: "Chat derivado a una persona",
    detalle: d.ultimoMensaje ? `${d.nombre}: ${d.ultimoMensaje}` : d.nombre,
    fecha: d.desde,
    href: `/admin/conversaciones?id=${encodeURIComponent(d.id)}`,
  };
}

export interface ReclamoFuente {
  id: string;
  estado: string;
  motivo: string;
  createdAt: string;
}

export function deReclamo(r: ReclamoFuente): Notificacion {
  return {
    id: `reclamo-${r.id}`,
    tipo: "reclamo",
    titulo: r.estado === "en_curso" ? "Reclamo en curso" : "Reclamo abierto",
    detalle: recortar(r.motivo, MAX_MOTIVO),
    fecha: r.createdAt,
    href: "/admin/reclamos?estado=abierto",
  };
}

export interface HabilitacionFuente {
  id: string;
  courierName: string;
  requestedAt: string;
}

export function deHabilitacion(h: HabilitacionFuente): Notificacion {
  return {
    id: `habilitacion-${h.id}`,
    tipo: "habilitacion",
    titulo: "Repartidor pide habilitación",
    detalle: h.courierName.trim() || "Repartidor",
    fecha: h.requestedAt,
    href: "/admin/repartidores",
  };
}

/** Junta las fuentes, ordena por fecha (más nueva primero) y recorta. `total` cuenta todas antes del recorte. */
export function armarNotificaciones(grupos: ReadonlyArray<readonly Notificacion[]>, max = MAX_NOTIFICACIONES): NotificacionesRespuesta {
  const todas = grupos.flat().sort((a, b) => tiempo(b.fecha) - tiempo(a.fecha));
  return { items: todas.slice(0, max), total: todas.length };
}

/** Cuántas son más nuevas que `vistoHasta` (ISO). Sin "visto hasta" válido, todas cuentan. */
export function contarNoVistas(items: readonly Notificacion[], vistoHasta: string | null): number {
  const corte = vistoHasta ? Date.parse(vistoHasta) : NaN;
  if (!Number.isFinite(corte)) return items.length;
  return items.filter((n) => tiempo(n.fecha) > corte).length;
}

/** Fecha más nueva de la lista (para guardar como "visto hasta"), o null si está vacía. */
export function fechaMasNueva(items: readonly Notificacion[]): string | null {
  let max: Notificacion | null = null;
  for (const n of items) if (!max || tiempo(n.fecha) > tiempo(max.fecha)) max = n;
  return max ? new Date(tiempo(max.fecha)).toISOString() : null;
}

/** "hace 5 min", "hace 2 h", "hace 3 días" o "recién". */
export function haceCuanto(iso: string, ahora: Date = new Date()): string {
  const seg = Math.max(0, Math.floor((ahora.getTime() - tiempo(iso)) / 1000));
  if (seg < 60) return "recién";
  const min = Math.floor(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
}
