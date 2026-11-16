/** Cliente simulado: prompt y parser de su próximo mensaje (puros, sin red). */
import type { Scenario } from "./escenarios.ts";
import type { TranscriptLine } from "./juez.ts";

export function clientSystem(s: Scenario): string {
  return [
    "Sos un cliente argentino escribiéndole por WhatsApp a un local de comida. NO sos un asistente.",
    `Persona: ${s.persona}.`,
    `Tu objetivo: ${s.goal}`,
    "Escribí como una persona real por WhatsApp: mensajes cortos, con tu estilo (faltas, jerga o emojis si van con tu persona).",
    "Si el local te pide un dato (dirección, confirmar con SÍ), respondelo de forma coherente; inventá una dirección de Palermo si hace falta.",
    "Tu objetivo tiene varios pasos: cumplilos TODOS en orden (por ejemplo, si dice que después cancelás o cambiás algo, hacelo). No termines antes.",
    'Devolvé SOLO JSON: {"mensaje":"tu próximo mensaje","fin":false}. Poné "fin":true (mensaje vacío) solo cuando cumpliste todos los pasos o te derivaron a una persona.',
  ].join("\n");
}

export function clientUser(transcript: readonly TranscriptLine[]): string {
  if (transcript.length === 0) return "Empezá la conversación con tu primer mensaje.";
  const chat = transcript.map((l) => `${l.role === "cliente" ? "VOS" : "LOCAL"}: ${l.text}`).join("\n");
  return `Conversación hasta ahora:\n${chat}\n\nEscribí tu próximo mensaje.`;
}

export function parseClientTurn(raw: string): { message: string; done: boolean } {
  try {
    const v = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { mensaje?: unknown; fin?: unknown };
    const message = typeof v.mensaje === "string" ? v.mensaje.trim().slice(0, 800) : "";
    return { message, done: v.fin === true || !message };
  } catch {
    return { message: "", done: true };
  }
}
