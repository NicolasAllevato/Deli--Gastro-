import type { ErrorEstado } from "@/lib/kb/errores-view";

/** Acciones del admin sobre sugerencias y errores aprendidos (las valida el servidor contra el estado actual). */
export type Accion = "aprobar" | "rechazar" | "desactivar" | "reabrir";

export interface ErrorAprendido {
  id: string;
  escenario: string;
  tipo: string;
  mensaje_cliente: string;
  respuesta_mala: string;
  motivo: string;
  correccion: string;
  veces: number;
  estado: ErrorEstado;
  ultima_prueba: "ok" | "falla" | null;
  origen?: "simulacion" | "conversacion";
}

export const ORIGEN_LABEL = (o: string | undefined) => (o === "conversacion" ? "conversación real" : "simulación");

export const ESTADO_BADGE: Record<string, string> = {
  pendiente: "badge-yellow",
  aprobada: "badge-green",
  rechazada: "badge-red",
  desactivada: "badge-blue",
};
