/** Turno listo para el clasificador: un mensaje combinado por conversación (sin tipos de Cloudflare). */
export interface InboundTurn {
  phone: string;
  text: string;
  wamids: string[];
  /** Audios a transcribir; cada uno aparece en `text` como `[audio:<wamid>]`. */
  audios: { wamid: string; mediaId: string }[];
  /** Fotos del turno (opcional: los turnos encolados antes de este cambio no lo traen). */
  images?: { wamid: string; mediaId: string }[];
  receivedAt: number;
}
