/** Conocimiento del agente (entrega 2): reglas del prompt, herramientas en pedidos y consultas sin respuesta. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildResponderPrompt } from "../workers/whatsapp-bot/src/bot/prompts.ts";
import { settingsFromConfig } from "../workers/whatsapp-bot/src/bot/settings.ts";

const OPEN = { agente_activo: true, horario_apertura: "00:00", horario_cierre: "23:59" };
const CLOSED = { horario_apertura: "03:00", horario_cierre: "03:01" };

describe("prompt: consultas del local en medio de un pedido", () => {
  it("con pedidos encendidos, el foco de pedido manda usar get_business_info y retomar el pedido", () => {
    const settings = settingsFromConfig({ ...OPEN, bot_orders_enabled: true });
    for (const intent of ["pedido_nuevo", "pedido_datos", "pedido_confirmar"] as const) {
      const prompt = buildResponderPrompt(settings, intent, null, false);
      assert.match(prompt, /en medio del pedido pregunta algo del local \(horario, zonas de envío, formas de pago, políticas/, intent);
      assert.match(prompt, /get_business_info/, intent);
      assert.match(prompt, /retomá el pedido/, intent);
    }
  });
});
