/** Turno listo para el clasificador: un mensaje combinado por conversación (sin tipos de Cloudflare). */
export interface InboundTurn {
  phone: string;
  text: string;
  wamids: string[];
  /** Audios a transcribir; cada uno aparece en `text` como `[audio:<wamid>]`. */
  audios: { wamid: string; mediaId: string }[];
  receivedAt: number;
}
