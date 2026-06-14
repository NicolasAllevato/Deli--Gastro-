/**
 * Deli-Gastro Chatbot Worker
 *
 * Reemplaza el webhook de n8n para el asistente virtual.
 * Recibe POST con { message: string, clientId: string } y llama a la API de Anthropic
 * directamente desde el edge, sin cold start.
 *
 * Requiere el secret ANTHROPIC_API_KEY configurado con:
 *   wrangler secret put ANTHROPIC_API_KEY
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 256;
const MAX_MESSAGE_LENGTH = 2000;

const SYSTEM_PROMPT =
  "Sos el asistente virtual de Deli-Gastro, un restaurante delivery de comida saludable en Argentina. " +
  "Respondé preguntas sobre el menú, tiempos de entrega y estado de pedidos de manera amigable y en español argentino. " +
  "Sé conciso (máx 2-3 oraciones).";

const FALLBACK_REPLY =
  "Disculpá, el asistente no está disponible en este momento.";

/**
 * Llama a la API de Anthropic y devuelve el texto de la respuesta.
 *
 * @param {string} apiKey
 * @param {string} message
 * @returns {Promise<string>}
 */
async function callAnthropic(apiKey, message) {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: message }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Anthropic API error ${response.status}: ${errorText.slice(0, 200)}`
    );
  }

  const json = await response.json();

  // La respuesta tiene la forma: { content: [{ type: "text", text: "..." }] }
  const textBlock = json?.content?.find((block) => block.type === "text");
  if (!textBlock?.text) {
    throw new Error("Anthropic API devolvió una respuesta inesperada");
  }

  return textBlock.text.trim();
}

export default {
  /**
   * @param {Request} request
   * @param {{ ANTHROPIC_API_KEY?: string }} env
   * @param {ExecutionContext} ctx
   * @returns {Promise<Response>}
   */
  async fetch(request, env, ctx) {
    // Solo aceptar POST
    if (request.method !== "POST") {
      return Response.json({ error: "Method Not Allowed" }, { status: 405 });
    }

    // Parsear body
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { message, clientId } = body;

    // Validar message
    if (!message || typeof message !== "string") {
      return Response.json({ error: "message is required" }, { status: 400 });
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return Response.json(
        { error: "message too long (max 2000 chars)" },
        { status: 400 }
      );
    }

    // Validar clientId si está presente
    if (
      clientId !== undefined &&
      (typeof clientId !== "string" || clientId.length > 100)
    ) {
      return Response.json({ error: "Invalid clientId" }, { status: 400 });
    }

    // Verificar que el secret esté configurado
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error("[chatbot] ANTHROPIC_API_KEY no configurada");
      return Response.json({ reply: FALLBACK_REPLY });
    }

    // Llamar a Anthropic — si falla, devolvemos fallback con 200
    try {
      const reply = await callAnthropic(apiKey, message);
      return Response.json({ reply });
    } catch (error) {
      console.error("[chatbot] Error llamando a Anthropic:", error?.message ?? error);
      return Response.json({ reply: FALLBACK_REPLY });
    }
  },
};
