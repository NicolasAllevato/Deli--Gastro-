import type { BotTool } from "../ai/responder.ts";
import { toolsForIntent } from "../guardrails.ts";
import type { BotConversation, BotRepo, KnowledgeEntry } from "../repo/types.ts";
import { openNow, type BotSettings } from "./settings.ts";
import { promosForModel, promosForToday } from "./greeting.ts";
import { cartaCategoryForModel, cartaMenuForModel, categoryForModel, menuForModel, MENU_RESULT_CHARS } from "./menu.ts";
import { LEGACY_STATUS, money, runCancel, runConfirm, runQuote, runStatus, type OrderTurn } from "../orders/flow.ts";

const EMPTY = { type: "object", properties: {} };
const PAYMENT_METHODS = ["Efectivo", "Transferencia", "Mercado Pago"];

/** Registro de errores de las herramientas (el turno pasa su `deps.log`). Nunca con datos del cliente. */
export type ToolLog = (message: string, detail?: unknown) => void;
const defaultLog: ToolLog = (message, detail) => console.error(message, detail);

/** Entradas de conocimiento relevantes para `tema`. Si la búsqueda falla se registra y la herramienta sigue sin ellas (no se corta la respuesta). */
async function searchKnowledge(repo: BotRepo, tema: string, log: ToolLog): Promise<KnowledgeEntry[]> {
  if (!repo.searchKnowledge) return [];
  try {
    return await repo.searchKnowledge(tema);
  } catch (error: unknown) {
    log("[whatsapp-bot] get_business_info: no se pudo buscar en el conocimiento", { error: error instanceof Error ? error.message : "error" });
    return [];
  }
}

const TEMA_STOPWORDS = new Set(["tienen", "tenes", "tenés", "tiene", "hacen", "algo", "para", "como", "cómo", "hola", "ola", "quiero", "saber", "pueden", "puedo", "alguna", "alguno", "algun", "algún"]);
const normalizar = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Productos del menú cuyo nombre o descripción nombran lo que el cliente pregunta («sin tacc» → «Pizza de harina de arroz (sin TACC)»).
 * Palabras de 4 letras o más, sin las de relleno: así «tienen sushi» no trae nada y no se inventa una coincidencia.
 */
export function menuMatchesForTema(menu: readonly { name: string; description: string | null; price: number; category: string }[], tema: string): { name: string; category: string; price_text: string }[] {
  const tokens = normalizar(tema).split(/[^a-z0-9ñ]+/).filter((t) => t.length >= 4 && !TEMA_STOPWORDS.has(t));
  if (tokens.length === 0) return [];
  return menu
    .filter((p) => {
      const hay = normalizar(`${p.name} ${p.description ?? ""}`);
      return tokens.some((t) => hay.includes(t));
    })
    .slice(0, 8)
    .map((p) => ({ name: p.name, category: p.category, price_text: money(p.price) }));
}

/** El motivo del traspaso empieza con «consulta»: no es un reclamo sino una pregunta del local sin respuesta cargada. */
export const isConsultaReason = (reason: string): boolean => /^\s*consulta\b/i.test(reason);

const minutesSince = (date: Date, now: number): number => Math.max(0, Math.round((now - date.getTime()) / 60_000));

const OBJECT_NO_EXTRA = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });

/**
 * Herramientas de pedidos (fase 5, solo con el flag encendido). El modelo no manda precios, totales, cliente,
 * wamid ni conversación: los fija el turno. El texto que ve el cliente sale de plantillas (orders/flow.ts).
 */
/** true = la dirección es la del perfil y el cliente no la confirmó todavía: no se cotiza. */
export type AddressGuard = (address: string) => boolean;

export const UNCONFIRMED_ADDRESS = {
  ok: false,
  error: "Esa es la dirección guardada del cliente y todavía no la confirmó. Preguntale si lo mandamos a la misma dirección y esperá su respuesta.",
};

export function orderTools(order: OrderTurn, guard?: AddressGuard): BotTool[] {
  return [
    {
      name: "quote_order",
      description:
        "Cotiza el pedido con productos (product_id de get_menu y cantidad) y la dirección de entrega. El resumen con el total se le envía solo al cliente. " +
        "Las empanadas se venden sueltas Y por docena y se pueden pedir en cualquier cantidad: para N empanadas mandá el producto de la docena (el llamado exactamente «empanadas», categoría Platos Principales, 12 unidades; NO uses «12 empanadas» de Promos) × floor(N/12) y el producto del gusto × (N mod 12) en la MISMA cotización (ej. 31 = 2 docenas + 7 sueltas). Nunca rechaces ni cambies la cantidad porque no sea múltiplo de 12; si la herramienta falla, corregí los argumentos y volvé a llamarla sin inventar un motivo. Si el cliente pide docena(s) sin decir los gustos, ANTES de cotizar preguntale de qué gustos quiere cada docena (se puede mezclar); al confirmar, pasá esos gustos en notes de confirm_order (ej. «Docena 1: 6 carne, 6 jamón y queso»).",
      parameters: OBJECT_NO_EXTRA(
        {
          items: { type: "array", minItems: 1, maxItems: 30, items: OBJECT_NO_EXTRA({ product_id: { type: "string" }, qty: { type: "integer", minimum: 1, maximum: 100 } }, ["product_id", "qty"]) },
          address: { type: "string", minLength: 5, maxLength: 200 },
        },
        ["items", "address"],
      ),
      run: async (args) => {
        const address = typeof (args as { address?: unknown })?.address === "string" ? (args as { address: string }).address : "";
        if (guard && address && guard(address)) return UNCONFIRMED_ADDRESS;
        return runQuote(order, args);
      },
    },
    {
      name: "confirm_order",
      description: "Confirma el pedido cotizado. Solo funciona si el cliente respondió SÍ al resumen. Efectivo: el pedido queda hecho y se paga al recibir. Mercado Pago: genera el link de pago.",
      parameters: OBJECT_NO_EXTRA({ payment_method: { type: "string", enum: ["Efectivo", "Mercado Pago"] }, notes: { type: "string", maxLength: 300 } }, ["payment_method"]),
      run: (args) => runConfirm(order, args),
    },
    {
      name: "cancel_order",
      description: "Cancela el pedido en curso (solo si está en Recibidos). Primero se le pregunta al cliente; confirmed:true solo después de que responda SÍ a esa pregunta.",
      parameters: OBJECT_NO_EXTRA({ confirmed: { type: "boolean" } }, ["confirmed"]),
      run: (args) => runCancel(order, args),
    },
  ];
}

/** Deja explícito si el pago ya se acreditó (pedido encontrado y sin pago pendiente): el modelo lo puede decir tal cual. */
function describePayment(data: unknown): unknown {
  if (typeof data !== "object" || data === null) return data;
  const d = data as Record<string, unknown>;
  if (d.found !== true) return d;
  return { ...d, payment: d.awaiting_payment === true ? "pendiente: falta pagar con el link" : "acreditado" };
}

/** Herramientas de solo lectura y traspaso; con el flag de pedidos, `get_menu` incluye el id y `order_status` va por la app. */
function allTools(
  repo: BotRepo, conversation: BotConversation, settings: BotSettings, now: () => number, order?: OrderTurn, guard?: AddressGuard, log: ToolLog = defaultLog,
): BotTool[] {
  return [
    {
      name: "get_menu",
      description: "Menú COMPLETO agrupado por categoría (con emoji): cada producto con nombre y price_text (ya formateado, copialo tal cual)" + (order ? " y su id (product_id para quote_order)." : "."),
      parameters: EMPTY,
      maxResultChars: MENU_RESULT_CHARS,
      run: async () => {
        const [menu, carta] = await Promise.all([repo.menu(), repo.carta ? repo.carta() : Promise.resolve([])]);
        return carta.length > 0 ? cartaMenuForModel(carta, menu, Boolean(order)) : menuForModel(menu, Boolean(order));
      },
    },
    {
      name: "get_categoria",
      description: "TODOS los productos de una categoría o familia con su precio (ej.: \"pizzas\", \"empanadas\", \"bebidas\", \"postres\", \"promos\", \"cafetería\" o el nombre exacto de una categoría). Tolera tildes, plurales y sinónimos (muzza, fugazzeta, napolitana → pizzas).",
      parameters: { type: "object", properties: { categoria: { type: "string", maxLength: 60 } }, required: ["categoria"] },
      maxResultChars: MENU_RESULT_CHARS,
      run: async (args) => {
        const q = typeof (args as { categoria?: unknown })?.categoria === "string" ? (args as { categoria: string }).categoria : "";
        const carta = repo.carta ? await repo.carta() : [];
        const fromCarta = carta.length > 0 ? cartaCategoryForModel(carta, q.slice(0, 60), Boolean(order)) : null;
        return fromCarta ?? categoryForModel(await repo.menu(), q.slice(0, 60), Boolean(order));
      },
    },
    {
      name: "get_business_info",
      description:
        "Información del local: horario, si está abierto ahora, demora estimada, zonas de envío con tarifa y pedido mínimo, formas de pago, y lo que el local cargó en su base de conocimiento (preguntas frecuentes, políticas, promos, ubicación, cancelaciones, etc.). " +
        "Completá `tema` con lo que el cliente quiere saber, en sus palabras (por ejemplo: \"cancelar un pedido\", \"sin tacc\", \"dónde queda el local\"): la herramienta busca y devuelve en `knowledge` solo las entradas que tratan de ese tema, no todas. " +
        "Si `knowledge` viene vacío y lo que pregunta no está en los demás datos, no lo sabés: no lo inventes.",
      parameters: {
        type: "object",
        properties: {
          tema: {
            type: "string",
            maxLength: 200,
            description: "Lo que el cliente pregunta o quiere saber del local, en pocas palabras y con sus términos (ej.: \"horario del domingo\", \"se puede pagar con tarjeta\", \"cómo cancelo\").",
          },
        },
        required: ["tema"],
      },
      // Hasta 8 entradas de hasta 1000 caracteres más los datos fijos: más que el tope general, para no cortar el JSON a la mitad.
      maxResultChars: 12_000,
      run: async (args) => {
        const tema = typeof (args as { tema?: unknown })?.tema === "string" ? (args as { tema: string }).tema.slice(0, 200) : "";
        const found = await searchKnowledge(repo, tema, log);
        const menuMatches = tema.trim() ? menuMatchesForTema(await repo.menu().catch(() => []), tema) : [];
        return {
          business: settings.businessName,
          hours: settings.hours,
          open_now: openNow(settings, new Date(now())),
          estimated_minutes: settings.estimatedMinutes,
          zones: (await repo.zones()).map((z) => ({ name: z.name, delivery_fee: z.fee, delivery_fee_text: money(z.fee), min_order: z.minOrder, min_order_text: money(z.minOrder) })),
          payment_methods: PAYMENT_METHODS,
          // Cobertura por distancia (si el local la cargó): el bot no puede prometer envíos más lejos ni otra tarifa por km.
          ...(settings.deliveryRadiusKm !== null ? { delivery_radius_km: settings.deliveryRadiusKm } : {}),
          ...(settings.deliveryCostPerKm !== null ? { delivery_cost_per_km_text: money(settings.deliveryCostPerKm) } : {}),
          // Cargado por el dueño en /admin/conocimiento: solo lo relacionado con `tema` (el vocabulario va al prompt, no acá).
          knowledge: found.map(({ category, topic, content }) => ({ category, topic, content })),
          // Productos del menú que nombran el tema (ej. «sin tacc»): precio vivo; el modelo los ofrece en vez de derivar.
          ...(menuMatches.length > 0 ? { menu_matches: menuMatches } : {}),
          ...(tema.trim() && found.length === 0 && menuMatches.length === 0
            ? { knowledge_note: `No hay nada cargado sobre «${tema.replace(/\s+/g, " ").trim().slice(0, 80)}». Si tampoco está en los datos de arriba, no lo inventes: decile que lo consultás con el local y derivá con handoff_to_human con motivo "consulta".` }
            : {}),
        };
      },
    },
    {
      name: "get_promos_hoy",
      description: "Promos de HOY del catálogo (según el día y la hora de Argentina), con price_text ya formateado. Usala si preguntan qué promos hay.",
      parameters: EMPTY,
      run: async () => ({ promos: promosForModel(promosForToday(await repo.menu(), new Date(now()))) }),
    },
    {
      name: "order_status",
      description: "Estado del último pedido del cliente de esta conversación.",
      parameters: EMPTY,
      run: async () => {
        if (order) {
          const viaApp = await runStatus(order);
          if (viaApp !== LEGACY_STATUS) return describePayment(viaApp);
          // Fuera de la allowlist de pedidos: se consulta como antes, directo en la base.
        }
        // Siempre el cliente de ESTA conversación: el modelo no elige de quién es el pedido.
        const latest = conversation.clientId ? await repo.latestOrder(conversation.clientId) : null;
        if (!latest) return { found: false };
        return {
          found: true,
          order_code: `#${latest.id.slice(0, 8).toUpperCase()}`,
          status: latest.status,
          items: latest.itemsDesc,
          total: latest.total,
          courier: latest.courierName,
          minutes_since_order: minutesSince(latest.createdAt, now()),
        };
      },
    },
    {
      name: "handoff_to_human",
      description:
        "Queja o reclamo, el cliente pide una persona, o hizo una consulta sobre el local que no pudiste responder con las herramientas. Registra el caso (siempre) y, con el local abierto, deriva a una persona. " +
        "`reason`: qué pasó. Si es una consulta sin respuesta, empezalo con «consulta:» y la pregunta del cliente (ej.: \"consulta: si hacen pizzas sin gluten\").",
      parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
      run: async (args) => {
        // Con reclamos disponibles, el turno registra el ticket y manda el aviso fijo (número de reclamo, pedido, foto).
        if (repo.createComplaint) {
          const reason = typeof (args as { reason?: unknown })?.reason === "string" ? (args as { reason: string }).reason : "";
          const kind = isConsultaReason(reason) ? "consulta" : "reclamo";
          await repo.createComplaint({ conversationId: conversation.id, phone: conversation.phone, clientId: conversation.clientId, motivo: reason, kind });
          const closed = !openNow(settings, new Date(now()));
          if (kind === "consulta") {
            return {
              ok: true,
              ticket: true,
              note: closed
                ? `El local está cerrado: NO digas que te atiende una persona. La consulta quedó registrada; el local la responde cuando abra (a las ${settings.hours.open}).`
                : "La consulta quedó registrada y una persona del local le va a responder a la brevedad.",
            };
          }
          return {
            ok: true,
            ticket: true,
            note: closed
              ? `El local está cerrado: NO digas que te atiende una persona. El reclamo quedó registrado; el local lo contacta cuando abra (a las ${settings.hours.open}).`
              : "El reclamo quedó registrado y una persona del local le va a responder a la brevedad.",
          };
        }
        await repo.setTakeover(conversation.id);
        return { ok: true, note: "Avisale al cliente que una persona del local le va a responder a la brevedad." };
      },
    },
    ...(order ? orderTools(order, guard) : []),
  ];
}

/** Solo las herramientas que la intención permite (lista blanca de guardrails.ts). Sin `order` (flag apagado) no existen las de pedidos. */
export function toolsFor(
  intent: string, repo: BotRepo, conversation: BotConversation, settings: BotSettings, now: () => number = Date.now, order?: OrderTurn, guard?: AddressGuard,
  log: ToolLog = defaultLog,
): BotTool[] {
  const allowed = new Set(toolsForIntent(intent));
  return allTools(repo, conversation, settings, now, order, guard, log).filter((t) => allowed.has(t.name));
}
