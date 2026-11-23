import type { Categoria } from "@/lib/reclamos/categoria";

export type Estado = "abierto" | "en_curso" | "resuelto";

export interface ReclamoItem {
  id: string;
  numero: number;
  conversation_id: string;
  client_phone: string;
  client_name: string | null;
  order_id: string | null;
  categoria: Categoria;
  motivo: string;
  foto_keys: string[];
  estado: Estado;
  resolucion: string | null;
  compensacion_tipo: "puntos" | "descuento" | "saldo" | null;
  compensacion_valor: number | null;
  notas: string | null;
  created_at: string;
  resolved_at: string | null;
  notified_at: string | null;
  sugerencia: Sugerencia | null;
  sugerencia_at: string | null;
  sugerencia_error: string | null;
  mensaje_resolucion: string | null;
  notificacion_estado: "enviado" | "fallo" | null;
  notificacion_error: string | null;
}

export interface Sugerencia {
  diagnostico: string;
  resolucion: { tipo: "disculpa" | "reenvio" | "puntos" | "saldo" | "descuento"; valor?: number | null; motivo: string };
  mensaje: string;
}

export const SUGERENCIA_LABEL: Record<Sugerencia["resolucion"]["tipo"], string> = {
  disculpa: "Disculpa",
  reenvio: "Reenvío",
  puntos: "Puntos",
  saldo: "Saldo a favor",
  descuento: "Descuento",
};

export interface ReclamoDetalleData extends ReclamoItem {
  eventos: { id: string; tipo: string; detalle: string; autor: string; created_at: string }[];
  pedido: { id: string; status: string; items_desc: string; total_cents: number; created_at: string } | null;
}

export const ESTADO_LABEL: Record<Estado, string> = { abierto: "Abierto", en_curso: "En curso", resuelto: "Resuelto" };
export const ESTADO_BADGE: Record<Estado, string> = { abierto: "badge-red", en_curso: "badge-yellow", resuelto: "badge-green" };

export async function call<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "No se pudo completar la operación.");
  return json;
}
