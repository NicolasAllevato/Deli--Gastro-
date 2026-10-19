import { createWhatsAppClient, type WhatsAppClient } from "../../../../src/lib/whatsapp/client.ts";
import { MODELS } from "../ai/models.ts";

/** Audios de WhatsApp: tope para no transcribir archivos enormes (≈ 3–4 minutos de nota de voz). */
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARS = 1500;

export function whatsappClient(accessToken: string, phoneNumberId: string): WhatsAppClient {
  return createWhatsAppClient({ accessToken, phoneNumberId });
}

function toBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Descarga el audio de Meta y lo transcribe con Whisper en Workers AI; null si algo falla. */
export function audioTranscriber(ai: Ai, wa: WhatsAppClient) {
  return async (mediaId: string): Promise<string | null> => {
    const media = await wa.downloadMedia(mediaId, MAX_AUDIO_BYTES);
    const out = (await ai.run(MODELS.transcriber as Parameters<Ai["run"]>[0], { audio: toBase64(media.data) } as never)) as { text?: string };
    const text = out.text?.trim();
    return text ? text.slice(0, MAX_TRANSCRIPT_CHARS) : null;
  };
}
