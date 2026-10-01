import { createAdminClient } from "@/utils/supabase/admin";
import { formatMoney, formatOrderId, isActiveStatus, minutesSince, REWARDS } from "@/lib/orders";
import { getClientByUserId, numberConfig, readConfig } from "@/lib/orders-server";

/**
 * Asistente del modo demo: responde por reglas con datos reales del store
 * (pedido del cliente, menú, puntos, config). Reemplaza al flujo de n8n/IA
 * mientras no haya conexiones externas.
 */

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const has = (text: string, words: readonly string[]) => words.some((w) => text.includes(w));

export async function buildDemoReply(userId: string, message: string): Promise<string> {
  const text = normalize(message);
  const db = createAdminClient();
  const [client, config] = await Promise.all([getClientByUserId(db, userId), readConfig(db)]);
  const firstName = client?.name.split(" ")[0] ?? "";

  if (has(text, ["pedido", "donde", "estado", "demora", "llega", "tarda"])) {
    if (!client) return "No encuentro tu perfil de cliente todavía.";
    const { data: orders } = await db
      .from("orders")
      .select("id, status, created_at, courier_name")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false })
      .limit(5);
    const active = (orders ?? []).find((o) => isActiveStatus(o.status));
    if (!active) return "No tenés pedidos activos ahora. ¿Querés que te recomiende algo del menú?";

    const eta = Math.max(5, numberConfig(config, "tiempo_entrega_min", 30) - minutesSince(active.created_at));
    const stage: Record<string, string> = {
      Recibidos: "ya lo recibimos y en un momento empieza la preparación",
      "En Preparación": "está en preparación en la cocina",
      "En Camino": `ya salió${active.courier_name ? ` con ${active.courier_name}` : ""} hacia tu dirección`,
    };
    return `Tu pedido ${formatOrderId(active.id)} ${stage[active.status] ?? "está en curso"}. Tiempo estimado: unos ${eta} min.`;
  }

  if (has(text, ["menu", "carta", "comer", "recomend", "hamburg", "pizza", "postre", "bebida"])) {
    const { data: products } = await db
      .from("products")
      .select("name, price")
      .eq("is_active", true)
      .order("price", { ascending: true })
      .limit(40);
    const picks = (products ?? []).slice(0, 5).map((p) => `• ${p.name} — ${formatMoney(Number(p.price))}`);
    return `Estos son algunos platos disponibles:\n${picks.join("\n")}\n\nPodés verlos todos en Inicio y sumarlos al carrito.`;
  }

  if (has(text, ["punto", "recompensa", "canje", "nivel", "fidelidad"])) {
    if (!client) return "Todavía no tenés puntos acumulados.";
    const next = REWARDS.filter((r) => r.puntosRequeridos > client.total_points).sort(
      (a, b) => a.puntosRequeridos - b.puntosRequeridos,
    )[0];
    const tail = next
      ? `Te faltan ${next.puntosRequeridos - client.total_points} pts para "${next.nombre}".`
      : "¡Ya podés canjear cualquier recompensa!";
    return `${firstName ? `${firstName}, t` : "T"}enés ${client.total_points} puntos (nivel ${client.tier}). ${tail}`;
  }

  if (has(text, ["horario", "abierto", "abren", "abre", "cierra", "cierran", "hora"])) {
    return `Atendemos de ${String(config.horario_apertura ?? "11:00")} a ${String(config.horario_cierre ?? "23:00")}.`;
  }

  if (has(text, ["cancel", "anular"])) {
    return `Podés cancelar desde "Mis pedidos" hasta ${numberConfig(config, "cancelacion_min", 15)} minutos después de hacerlo, siempre que todavía no haya entrado a cocina.`;
  }

  if (has(text, ["envio", "costo", "zona", "cuanto sale", "delivery"])) {
    return `Entregamos en un radio de ${numberConfig(config, "radio_delivery_km", 8)} km. El envío tiene una tarifa base más ${formatMoney(numberConfig(config, "costo_por_km", 150))} por km; lo ves antes de confirmar.`;
  }

  if (has(text, ["pago", "pagar", "tarjeta", "efectivo", "mercado"])) {
    return "Aceptamos efectivo, tarjeta y Mercado Pago. Elegís el medio al confirmar el pedido.";
  }

  if (has(text, ["hola", "buenas", "buen dia", "buenos"])) {
    return `¡Hola${firstName ? ` ${firstName}` : ""}! Puedo contarte el estado de tu pedido, el menú, tus puntos, horarios o costos de envío.`;
  }

  return "Todavía soy una versión de demostración: puedo ayudarte con tu pedido, el menú, tus puntos, horarios, envíos y formas de pago.";
}
