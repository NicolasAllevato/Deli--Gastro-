/** Revisión del borrador del modelo (draftIssue): vacío, plantilla, estado, precio, horario, zona, promesa y datos bloqueados. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { draftIssue, processTurn, SAFE_FALLBACK, type TurnDeps } from "../workers/whatsapp-bot/src/bot/turn.ts";
import { hoursMismatch, minutesOfDay, timesMentioned, zoneMismatch } from "../workers/whatsapp-bot/src/bot/draft-checks.ts";
import { settingsFromConfig } from "../workers/whatsapp-bot/src/bot/settings.ts";
import type { Intent } from "../workers/whatsapp-bot/src/ai/classifier.ts";
import type { OrderTurn } from "../workers/whatsapp-bot/src/orders/flow.ts";
import type { BotRepo } from "../workers/whatsapp-bot/src/repo/types.ts";

const HOURS = { open: "11:00", close: "23:00" };

describe("horarios: qué hora nombra una frase", () => {
  it("entiende 11:00, 23.30, 11 hs, a las 20, hasta las 23 y de 11 a 23", () => {
    assert.deepEqual(timesMentioned("abrimos a las 11:00"), [660]);
    assert.deepEqual(timesMentioned("cerramos 23.30"), [1410]);
    assert.deepEqual([...new Set(timesMentioned("atendemos de 11 hs a 23 hs"))].sort((a, b) => a - b), [660, 1380]);
    assert.deepEqual([...new Set(timesMentioned("abrimos a las 20"))], [1200]);
    assert.deepEqual([...new Set(timesMentioned("hasta las 23"))], [1380]);
    assert.deepEqual([...new Set(timesMentioned("de 11 a 23"))].sort((a, b) => a - b), [660, 1380]);
    assert.deepEqual([...new Set(timesMentioned("de 11:30 a 23:15 hs"))].sort((a, b) => a - b), [690, 1395]);
  });

  it("no confunde precios, minutos ni los minutos de otra hora", () => {
    assert.deepEqual(timesMentioned("la muzza sale $9.000 y tarda 30 minutos"), []);
    assert.deepEqual(timesMentioned("hasta las 23:00 hs"), [1380]);
    assert.deepEqual([...new Set(timesMentioned("abrimos a las 11:00 hs"))], [660]);
  });

  it("24:00 y 00:00 son lo mismo", () => {
    assert.equal(minutesOfDay("24:00"), 0);
    assert.equal(minutesOfDay("00:00"), 0);
    assert.equal(minutesOfDay("11:00"), 660);
    assert.equal(minutesOfDay("mañana"), null);
    assert.equal(minutesOfDay("25:00"), null);
  });
});

describe("horarios: el borrador contradice la configuración", () => {
  it("lo que coincide con apertura o cierre pasa", () => {
    for (const text of [
      "Abrimos todos los días de 11 a 23 hs.",
      "Atendemos de 11:00 a 23:00.",
      "Abrimos a las 11 y cerramos a las 23.",
      "Cerramos a las 23.00 hs 😊",
      "Nuestro horario es de 11 a 23.",
    ]) assert.equal(hoursMismatch(text, HOURS), false, text);
  });

  it("un horario de apertura o cierre distinto se marca", () => {
    for (const text of [
      "Abrimos a las 19 hs.",
      "Atendemos de 10 a 22.",
      "Cerramos a las 23:30.",
      "Nuestro horario es de 11 a 24.",
      "Hasta las 20 estamos atendiendo.",
      "Abrimos desde las 12:00",
    ]) assert.equal(hoursMismatch(text, HOURS), true, text);
  });

  it("solo se miran las frases sobre abrir, cerrar o el horario", () => {
    assert.equal(hoursMismatch("Tu pedido llega a las 21 hs. Abrimos de 11 a 23.", HOURS), false);
    assert.equal(hoursMismatch("La muzza sale $9.000 y tarda unos 30 minutos.", HOURS), false);
    assert.equal(hoursMismatch("Podés cancelar dentro de los 20 minutos.", HOURS), false);
    assert.equal(hoursMismatch("Estamos en Av. Rivadavia 5000.", HOURS), false);
  });

  it("los feriados y fechas especiales no se controlan (la configuración no los expresa)", () => {
    assert.equal(hoursMismatch("Los feriados abrimos de 12 a 22.", HOURS), false);
    assert.equal(hoursMismatch("En Navidad cerramos a las 20.", HOURS), false);
  });

  it("con medianoche como cierre, 24 y 0 son válidos", () => {
    assert.equal(hoursMismatch("Cerramos a las 24 hs.", { open: "11:00", close: "00:00" }), false);
    assert.equal(hoursMismatch("Cerramos a las 23 hs.", { open: "11:00", close: "00:00" }), true);
  });

  it("sin un horario válido en la configuración no marca nada", () => {
    assert.equal(hoursMismatch("Abrimos a las 19.", { open: "", close: "23:00" }), false);
  });
});

describe("zonas: el borrador promete un envío que no figura", () => {
  const barrios = { zones: [{ name: "Palermo" }, { name: "Villa Crespo" }], radiusKm: null };

  it("un barrio que no es ninguna zona cargada se marca", () => {
    assert.equal(zoneMismatch("Sí, enviamos a Quilmes sin problema.", barrios), true);
    assert.equal(zoneMismatch("Hacemos envíos a Belgrano.", barrios), true);
    assert.equal(zoneMismatch("Llegamos hasta Villa Urquiza.", barrios), true);
  });

  it("un barrio cargado, sin tildes o en otra forma, pasa", () => {
    assert.equal(zoneMismatch("Sí, enviamos a Palermo.", barrios), false);
    assert.equal(zoneMismatch("Hacemos envíos a Villa Crespo!", barrios), false);
    assert.equal(zoneMismatch("Enviamos al barrio de Palermo.", barrios), false);
  });

  it("las frases negativas, las direcciones y los lugares en minúscula no cuentan", () => {
    assert.equal(zoneMismatch("Lamentablemente no enviamos a Quilmes.", barrios), false);
    assert.equal(zoneMismatch("Perfecto, te lo enviamos a Av. Rivadavia 5000.", barrios), false);
    assert.equal(zoneMismatch("Enviamos a Rivadavia 5000 en 30 minutos.", barrios), false);
    assert.equal(zoneMismatch("Enviamos a domicilio.", barrios), false);
  });

  it("con zonas sin nombre de lugar («Zona 1», «Radio 3 km») no hay con qué comparar un barrio", () => {
    const generic = { zones: [{ name: "Zona 1" }, { name: "Radio 3 km" }, { name: "Zona cercana" }], radiusKm: null };
    assert.equal(zoneMismatch("Sí, enviamos a Quilmes.", generic), false);
  });

  it("sin zonas ni radio cargados no marca nada", () => {
    assert.equal(zoneMismatch("Enviamos a Quilmes, hasta 40 km.", { zones: [], radiusKm: null }), false);
  });

  it("una distancia mayor al radio configurado se marca; igual o menor, no", () => {
    const radio = { zones: [], radiusKm: 5 };
    assert.equal(zoneMismatch("Hacemos envíos hasta 10 km del local.", radio), true);
    assert.equal(zoneMismatch("Llegamos hasta 5,5 km.", radio), true);
    assert.equal(zoneMismatch("Hacemos envíos hasta 5 km del local.", radio), false);
    assert.equal(zoneMismatch("El delivery llega hasta 3 km.", radio), false);
    // Negativas: avisar que algo queda lejos no es prometer el envío.
    assert.equal(zoneMismatch("Estás a 8 km, fuera de nuestra zona de envío.", radio), false);
    // Una frase que no habla de envíos no se mira.
    assert.equal(zoneMismatch("La pizzería queda a 8 km de la estación.", radio), false);
  });
});

// ---------- draftIssue completo ----------

const CONVERSATION = { id: "c1", phone: "5491170000001", clientId: null, displayName: null, humanTakeover: false };

function setup(config: Record<string, unknown> = {}, zones: { name: string; fee: number; minOrder: number }[] = []) {
  const settings = settingsFromConfig({ horario_apertura: "11:00", horario_cierre: "23:00", ...config });
  let zoneReads = 0;
  const repo = {
    menu: async () => [{ id: "p1", name: "Muzza", description: null, price: 9000, category: "Pizzas" }],
    zones: async () => (zoneReads++, zones),
  } as unknown as BotRepo;
  const deps = { repo, appUrl: "https://opsyndely.la-gambeta.com" } as unknown as TurnDeps;
  const issue = (draft: string, intent: Intent = "consulta_local", order?: OrderTurn, turnText = "") => draftIssue(draft, intent, CONVERSATION, deps, settings, order, turnText);
  return { issue, reads: () => zoneReads };
}

describe("draftIssue: todos los motivos", () => {
  it("empty: vacío o solo espacios", async () => {
    const { issue } = setup();
    assert.equal(await issue(""), "empty");
    assert.equal(await issue("  \n "), "empty");
  });

  it("template: imita un resumen de pedido (solo con pedidos encendidos)", async () => {
    const { issue } = setup();
    const draft = "Resumen de tu pedido: 1 muzza. Respondé SÍ para confirmar.";
    assert.equal(await issue(draft, "pedido_nuevo", {} as OrderTurn), "template");
    assert.equal(await issue(draft, "pedido_nuevo"), null);
  });

  it("state: afirma que el pedido está confirmado, pagado o en camino (salvo en pedido_estado)", async () => {
    const { issue } = setup();
    assert.equal(await issue("¡Listo! Tu pedido está confirmado."), "state");
    assert.equal(await issue("Tu pedido ya está en camino."), "state");
    assert.equal(await issue("Tu pedido está en camino.", "pedido_estado"), null);
  });

  it("limits: el modelo expone un tope interno o propone partir el pedido", async () => {
    const { issue } = setup();
    assert.equal(await issue("La cantidad máxima por línea es 100. ¿Hago dos líneas de 100 y 50?", "pedido_nuevo"), "limits");
    assert.equal(await issue("No puedo procesar 150 empanadas en una sola línea.", "pedido_nuevo"), "limits");
    assert.equal(await issue("Necesito dividir el pedido en varias líneas.", "pedido_nuevo"), "limits");
    assert.equal(await issue("Dale, ¿a qué dirección lo mandamos?", "pedido_nuevo"), null);
  });

  it("price: un monto que no es del menú, de las zonas ni el costo por km", async () => {
    const { issue } = setup({}, [{ name: "Palermo", fee: 600, minOrder: 0 }]);
    assert.equal(await issue("La muzza sale $12.345."), "price");
    assert.equal(await issue("La muzza sale $9.000."), null);
    assert.equal(await issue("El envío a Palermo es $600."), null);
  });

  it("price: el costo por km de la configuración es un monto válido", async () => {
    assert.equal(await setup({ costo_por_km: 200 }).issue("El envío cuesta $200 por km."), null);
    assert.equal(await setup().issue("El envío cuesta $200 por km."), "price");
  });

  it("hours: el horario no coincide con horario_apertura / horario_cierre", async () => {
    const { issue } = setup();
    assert.equal(await issue("Abrimos todos los días de 10 a 22 hs."), "hours");
    assert.equal(await issue("Abrimos todos los días de 11 a 23 hs."), null);
    assert.equal(await setup({ horario_apertura: "19:00", horario_cierre: "23:30" }).issue("Atendemos de 19 a 23:30."), null);
  });

  it("zone: promete envío a un barrio que no está en las zonas o a más km que el radio", async () => {
    const withZones = setup({}, [{ name: "Palermo", fee: 600, minOrder: 0 }]);
    assert.equal(await withZones.issue("Sí, enviamos a Quilmes."), "zone");
    assert.equal(await withZones.issue("Sí, enviamos a Palermo."), null);
    assert.equal(await setup({ radio_delivery_km: 5 }).issue("Llegamos hasta 12 km."), "zone");
    assert.equal(await setup({ radio_delivery_km: 5 }).issue("Llegamos hasta 5 km."), null);
  });

  it("zone: sin datos de zonas ni radio no marca nada, y no lee las zonas si el texto no habla de envíos", async () => {
    const none = setup();
    assert.equal(await none.issue("Sí, enviamos a Quilmes, hasta 40 km."), null);
    const quiet = setup({}, [{ name: "Palermo", fee: 600, minOrder: 0 }]);
    assert.equal(await quiet.issue("¡Hola! ¿En qué te ayudo?"), null);
    assert.equal(quiet.reads(), 0);
  });

  it("promise: «un momento» o «voy a verificar»", async () => {
    const { issue } = setup();
    assert.equal(await issue("Un momento, ya te lo confirmo."), "promise");
    assert.equal(await issue("Voy a verificar y te aviso."), "promise");
  });

  it("blocked: datos que no se pueden mandar (teléfono de otra persona, link desconocido)", async () => {
    const { issue } = setup();
    assert.equal(await issue("Escribile al 11 5555-1234 para consultar."), "blocked");
    assert.equal(await issue("Mirá https://sitio-raro.example/promo"), "blocked");
    assert.equal(await issue("Mirá https://opsyndely.la-gambeta.com/cliente"), null);
  });

  it("un borrador normal pasa", async () => {
    const { issue } = setup();
    assert.equal(await issue("¡Hola! Tenemos muzza a $9.000. ¿Te armo un pedido? 😊"), null);
  });

  it("orden de prioridad: el monto inventado gana al horario y el horario a la promesa", async () => {
    const { issue } = setup();
    assert.equal(await issue("Abrimos a las 19 y la muzza sale $12.345."), "price");
    assert.equal(await issue("Un momento, abrimos a las 19."), "hours");
  });
});

describe("turno: horario o zona inventados se reintentan y, si insiste, se consulta con el local", () => {
  function turnWorld(drafts: string[]) {
    const sent: string[] = [];
    const systems: string[] = [];
    let n = 0;
    const repo: BotRepo = {
      getConversation: async (phone) => ({ ...CONVERSATION, phone }),
      history: async () => [{ direction: "in", body: "hola" }],
      inboundCounts: async () => ({ lastMinute: 1, lastDay: 1 }),
      config: async () => ({ agente_activo: true, horario_apertura: "11:00", horario_cierre: "23:00", negocio_nombre: "La Gambeta" }),
      menu: async () => [],
      zones: async () => [],
      latestOrder: async () => null,
      setTakeover: async () => {},
      setMarketingOptIn: async () => 1,
      saveOutbound: async (_c, _w, body) => { sent.push(body); },
      saveTranscript: async () => {},
      lastOutboundAt: async () => new Date(),
    };
    let asked = 0;
    const run: TurnDeps["run"] = async (_m, input) => {
      if ("response_format" in input) return { response: JSON.stringify({ intent: "consulta_local", confidence: 0.95 }) };
      systems.push(String((input.messages as { content: string }[])[0]!.content));
      return { response: drafts[Math.min(asked++, drafts.length - 1)] };
    };
    const deps: TurnDeps = { repo, run, transcribe: async () => null, send: async () => `o-${++n}`, appUrl: "https://opsyndely.la-gambeta.com", log: () => {} };
    return { sent, systems, send: () => processTurn({ phone: CONVERSATION.phone, text: "¿a qué hora abren?", wamids: ["w1"], audios: [], receivedAt: 0 }, deps) };
  }

  it("horario equivocado: el reintento corrige y el cliente recibe la segunda versión", async () => {
    const w = turnWorld(["Abrimos a las 19 hs.", "Abrimos de 11 a 23 hs."]);
    assert.equal(await w.send(), "answered");
    assert.deepEqual(w.sent, ["Abrimos de 11 a 23 hs."]);
    assert.match(w.systems.at(-1)!, /CORRECCIÓN: El horario que dijiste no coincide con el del local/);
  });

  it("si insiste con un horario inventado, sale «Dejame consultarlo con el local y te confirmo.»", async () => {
    const w = turnWorld(["Abrimos a las 19 hs.", "Abrimos a las 19 hs."]);
    assert.equal(await w.send(), "output_blocked");
    assert.deepEqual(w.sent, ["Dejame consultarlo con el local y te confirmo."]);
  });
});

describe("draftIssue: pistas de reintento y respuesta segura", () => {
  it("horario y zona usan «Dejame consultarlo con el local y te confirmo.» si el modelo insiste", () => {
    assert.equal(SAFE_FALLBACK.hours, "Dejame consultarlo con el local y te confirmo.");
    assert.equal(SAFE_FALLBACK.zone, "Dejame consultarlo con el local y te confirmo.");
  });

  it("todos los motivos tienen respuesta segura", () => {
    for (const issue of ["empty", "template", "state", "price", "hours", "zone", "promise", "blocked"] as const) {
      assert.ok(SAFE_FALLBACK[issue].length > 0, issue);
    }
  });
});

describe("draftIssue: carta entera en un pedido (menu_dump)", () => {
  const CARTA = ["Desayunos y meriendas:", "• Café doble — $4.300", "• Jarrito — $3.900", "• Medialuna de manteca — $1.800", "• Medialuna de grasa — $1.800", "• Tostado de jamón y queso — $6.000", "• Café chico — $3.000", "¿Te gustaría pedir algo de esto?"].join("\n");

  it("descarta volcar la carta cuando el cliente nombró productos para pedir", async () => {
    const { issue } = setup();
    assert.equal(await issue(CARTA, "pedido_nuevo", undefined, "2 cafés con leche y 4 medialunas para Juramento 1500"), "menu_dump");
  });

  it("la carta es válida si el cliente la pidió o no es un pedido", async () => {
    const { issue } = setup();
    assert.notEqual(await issue(CARTA, "pedido_nuevo", undefined, "pasame la carta"), "menu_dump");
    assert.notEqual(await issue(CARTA, "consulta_menu", undefined, "qué tienen de desayuno?"), "menu_dump");
  });

  it("una pregunta corta por el producto ambiguo pasa", async () => {
    const { issue } = setup();
    assert.equal(await issue("¿La Quilmes la querés lata 473, lata zero o de 1 L? El resto ya lo tengo anotado.", "pedido_nuevo", undefined, "una Quilmes"), null);
  });

  it("tiene respuesta segura que no es la plantilla genérica", () => {
    assert.ok(SAFE_FALLBACK.menu_dump.length > 0);
    assert.doesNotMatch(SAFE_FALLBACK.menu_dump, /Decime qué querés pedir/);
  });
});
