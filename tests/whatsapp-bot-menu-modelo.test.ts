import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./helpers/alias.ts";
import { asksFullMenu, categoryEmoji, categoryForModel, menuForModel, MENU_RESULT_CHARS, productsForCategory } from "../workers/whatsapp-bot/src/bot/menu.ts";
import { isGreetingMessage, isPureGreeting, renderGreeting, shouldGreetNow, GREETING_GAP_MS } from "../workers/whatsapp-bot/src/bot/greeting.ts";
import { isStaleBotMessage, buildResponderPrompt } from "../workers/whatsapp-bot/src/bot/prompts.ts";
import { historyMessages, MENU_PDF_NOTE, MENU_PDF_REPLY, processTurn, type TurnDeps } from "../workers/whatsapp-bot/src/bot/turn.ts";
import { settingsFromConfig } from "../workers/whatsapp-bot/src/bot/settings.ts";
import { toolsFor } from "../workers/whatsapp-bot/src/bot/tools.ts";
import { classify, CLASSIFIER_PROMPT } from "../workers/whatsapp-bot/src/ai/classifier.ts";
import { respond } from "../workers/whatsapp-bot/src/ai/responder.ts";
import { MODELS, runWithFallback } from "../workers/whatsapp-bot/src/ai/models.ts";
import { openAiChatBody, openAiRunModel, routedRunModel } from "../workers/whatsapp-bot/src/ai/openai.ts";
import { createWhatsAppClient } from "../src/lib/whatsapp/client.ts";
import { groupForPdf, pesos, renderMenuPdf } from "../src/lib/menu-pdf.ts";
import type { BotRepo, MenuItem } from "../workers/whatsapp-bot/src/repo/types.ts";

const p = (name: string, category: string, price = 1000, description: string | null = null): MenuItem =>
  ({ id: `id-${name}`, name, category, price, description });

const MENU: MenuItem[] = [
  p("Coca-Cola 1,5 L", "Bebidas", 3500),
  p("Agua sin gas", "Bebidas", 1800),
  p("Empanada de carne", "Empanadas", 1500),
  p("Flan casero", "Postres", 3000),
  p("Muzzarella grande", "Platos Principales", 12000, "Salsa de tomate, muzzarella y aceitunas verdes de primera calidad, horneada a la piedra"),
  p("Fugazzeta", "Platos Principales", 13000),
  p("Napolitana", "Platos Principales", 13500),
  p("Milanesa con papas", "Platos Principales", 14000),
  p("PROMO Muzza + Coca", "Promos", 15000),
  p("Café con leche", "Cafetería", 2500),
];

describe("menú compacto (get_menu)", () => {
  it("agrupa por categoría con emoji, nombre y price_text, sin descripciones largas", () => {
    const out = menuForModel(MENU, false);
    assert.equal(out.total_productos, MENU.length);
    const principales = out.categorias.find((c) => c.categoria === "Platos Principales");
    assert.ok(principales);
    assert.equal(principales.productos.length, 4);
    assert.deepEqual(principales.productos[0], { name: "Muzzarella grande", price_text: "$12.000" });
    assert.equal(out.categorias.find((c) => c.categoria === "Bebidas")?.emoji, "🥤");
    assert.ok(!JSON.stringify(out).includes("aceitunas"));
  });

  it("con pedidos encendidos incluye el id", () => {
    assert.equal(menuForModel(MENU, true).categorias[0].productos[0].id, "id-Coca-Cola 1,5 L");
  });

  it("150 productos con nombres largos entran enteros bajo el tope (y la última categoría llega al modelo)", async () => {
    const big: MenuItem[] = Array.from({ length: 150 }, (_, i) =>
      ({ id: crypto.randomUUID(), name: `Producto con un nombre bastante largo número ${i}`, category: `Categoría ${String(Math.floor(i / 15)).padStart(2, "0")}`, price: 12345 + i, description: "x".repeat(300) }));
    const json = JSON.stringify(menuForModel(big, true));
    assert.ok(json.length < MENU_RESULT_CHARS, `ocupa ${json.length}`);
    const repo = { menu: async () => big } as unknown as BotRepo;
    const tool = toolsFor("consulta_menu", repo, { id: "c", phone: "1", clientId: null, displayName: null, humanTakeover: false }, settingsFromConfig({}), Date.now, {} as never)
      .find((t) => t.name === "get_menu");
    assert.ok(tool);
    let seen = "";
    const run: TurnDeps["run"] = async (_m, input) => {
      const msgs = input.messages as { role: string; content: string }[];
      const toolMsg = msgs.find((m) => m.role === "tool");
      if (!toolMsg) return { tool_calls: [{ id: "t1", function: { name: "get_menu", arguments: "{}" } }] };
      seen = toolMsg.content;
      return { response: "ok" };
    };
    await respond(run, { system: "s", history: [], userText: "menu", tools: [tool] });
    assert.ok(seen.includes("Categoría 09"));
    assert.doesNotThrow(() => JSON.parse(seen));
  });

  it("emojis por categoría", () => {
    assert.equal(categoryEmoji("Empanadas"), "🥟");
    assert.equal(categoryEmoji("Cafetería"), "☕");
    assert.equal(categoryEmoji("Rarezas"), "🍴");
  });
});

describe("get_categoria: búsqueda tolerante", () => {
  const names = (q: string) => productsForCategory(MENU, q).map((x) => x.name);

  it("«pizzas» encuentra las pizzas aunque no haya categoría Pizzas", () => {
    const got = names("pizzas");
    assert.ok(got.includes("Muzzarella grande") && got.includes("Fugazzeta") && got.includes("Napolitana") && got.includes("PROMO Muzza + Coca"));
    assert.ok(!got.includes("Milanesa con papas") && !got.includes("Coca-Cola 1,5 L"));
    assert.deepEqual(names("Pizza"), got);
    assert.deepEqual(names("las pizzas"), got);
  });

  it("categorías por nombre, sin tildes ni mayúsculas, en singular o plural", () => {
    assert.deepEqual(names("bebidas"), ["Coca-Cola 1,5 L", "Agua sin gas"]);
    assert.deepEqual(names("EMPANADA"), ["Empanada de carne"]);
    assert.deepEqual(names("postre"), ["Flan casero"]);
    assert.deepEqual(names("promos"), ["PROMO Muzza + Coca"]);
    assert.deepEqual(names("cafeteria"), ["Café con leche"]);
    assert.equal(names("platos principales").length, 4);
  });

  it("sin coincidencias devuelve las categorías disponibles (no inventa)", () => {
    const out = categoryForModel(MENU, "sushi", false);
    assert.equal(out.encontrado, false);
    assert.ok((out.categorias_disponibles as string[]).includes("Bebidas"));
  });

  it("con coincidencias trae todos los productos con precio y descripción corta", () => {
    const out = categoryForModel(MENU, "pizzas", true) as { cantidad: number; categorias: { productos: { price_text: string; desc?: string; id?: string }[] }[] };
    assert.equal(out.cantidad, 4);
    const first = out.categorias[0].productos[0];
    assert.equal(first.price_text, "$12.000");
    assert.ok(first.id);
    assert.ok((first.desc ?? "").length <= 60);
  });

  it("detecta cuándo pide la carta completa (no una categoría)", () => {
    for (const t of ["me pasás el menú?", "la carta porfa", "Qué tenés?", "que hay para comer"]) assert.equal(asksFullMenu(t), true, t);
    for (const t of ["qué pizzas tenés?", "menú de empanadas", "cuánto sale la muzza"]) assert.equal(asksFullMenu(t), false, t);
  });
});

describe("saludo al empezar la charla", () => {
  const now = Date.now();
  it("saluda tras más de 2 h sin respuestas del bot", () => {
    assert.equal(GREETING_GAP_MS, 2 * 60 * 60 * 1000);
    assert.equal(shouldGreetNow(new Date(now - GREETING_GAP_MS - 1), now, "quiero una muzza", []), true);
    assert.equal(shouldGreetNow(new Date(now - 60_000), now, "quiero una muzza", []), false);
  });

  it("un saludo puro saluda si el bot no saludó en los mensajes recientes", () => {
    assert.equal(shouldGreetNow(new Date(now - 60_000), now, "hola", ["Te paso el total"]), true);
    assert.equal(shouldGreetNow(new Date(now - 60_000), now, "Buen día!", ["¡Hola, Tata! 👋 Soy Gambe"]), false);
  });

  it("reconoce saludos puros y el mensaje de saludo del bot", () => {
    for (const t of ["hola", "Holaa!!", "buenas", "buen día", "Buenas noches", "hola, cómo andás?"]) assert.equal(isPureGreeting(t), true, t);
    for (const t of ["hola quiero una muzza", "buenas, hacen envío?"]) assert.equal(isPureGreeting(t), false, t);
    const settings = settingsFromConfig({ negocio_nombre: "La Gambeta" });
    assert.equal(isGreetingMessage(renderGreeting(settings, "Tata", [])), true);
  });
});

describe("historial sin plantillas viejas", () => {
  it("saca «decime humano», [link] y la derivación a la web con pedidos encendidos", () => {
    assert.equal(isStaleBotMessage("Podés hacer tu pedido acá: [link]. Si preferís, decime 'humano'", true), true);
    assert.equal(isStaleBotMessage("¡Genial! Podés hacer tu pedido acá: https://x/cliente", true), true);
    assert.equal(isStaleBotMessage("¡Genial! Podés hacer tu pedido acá: https://x/cliente", false), false);
    assert.equal(isStaleBotMessage("Tenemos muzza a $12.000", true), false);
    const h = historyMessages([
      { direction: "in", body: "hola" },
      { direction: "out", body: "Podés hacer tu pedido acá: [link]" },
      { direction: "out", body: "¿Qué te gustaría?" },
    ], true);
    assert.equal(h.length, 2);
    assert.equal(h[1].content, "¿Qué te gustaría?");
  });

  it("el prompt prohíbe copiar mensajes viejos, marcadores y negar productos sin revisar", () => {
    const prompt = buildResponderPrompt(settingsFromConfig({}), "consulta_menu", null, false);
    assert.match(prompt, /No copies ni imites mensajes anteriores/);
    assert.match(prompt, /\[link\]/);
    assert.match(prompt, /sin revisarlo antes con get_categoria o get_menu/);
    assert.match(prompt, /get_categoria y listá TODOS/);
  });
});

describe("clasificador: vocabulario rioplatense", () => {
  it("el prompt trae el vocabulario y ejemplos de pedido y de menú", () => {
    for (const w of ["muzza", "una grande", "media muzza", "fainá", "fugazzeta", "una de jamón", "docena", "para llevar", "envío", "quería pedirte", "me mandás", "cuánto sale", "qué tenés"]) {
      assert.ok(CLASSIFIER_PROMPT.toLowerCase().includes(w.toLowerCase()), w);
    }
    assert.match(CLASSIFIER_PROMPT, /quería pedirte una muzza grande" → pedido_nuevo/);
    assert.match(CLASSIFIER_PROMPT, /cuánto sale la fugazzeta\?" → consulta_menu/);
  });

  // Modelo falso que decide con el mismo criterio de los ejemplos: verifica que la frase llega envuelta y se parsea.
  const CASES: [string, string][] = [
    ["quería pedirte una muzza grande", "pedido_nuevo"],
    ["me mandás una docena de empanadas?", "pedido_nuevo"],
    ["una de jamón y una fainá para llevar", "pedido_nuevo"],
    ["media muzza media napo con envío", "pedido_nuevo"],
    ["cuánto sale la fugazzeta?", "consulta_menu"],
    ["qué tenés?", "consulta_menu"],
  ];
  for (const [phrase, intent] of CASES) {
    it(`«${phrase}» → ${intent}`, async () => {
      const run: TurnDeps["run"] = async (model, input) => {
        assert.equal(model, MODELS.classifier);
        const msgs = input.messages as { role: string; content: string }[];
        assert.equal(msgs[0].content, CLASSIFIER_PROMPT);
        const text = msgs.at(-1)!.content;
        assert.ok(text.includes(phrase));
        const order = /pedirte|mand[aá]s|una de|media/.test(text);
        return { choices: [{ message: { content: JSON.stringify({ intent: order ? "pedido_nuevo" : "consulta_menu", confidence: 0.9 }) } }] };
      };
      assert.deepEqual(await classify(run, `<mensaje_cliente>${phrase}</mensaje_cliente>`, null), { intent, confidence: 0.9 });
    });
  }
});

describe("modelo: OpenAI gpt-4o-mini con respaldo de Workers AI", () => {
  it("clasificador y respondedor usan gpt-4o-mini; los respaldos son de Workers AI", () => {
    assert.equal(MODELS.classifier, "gpt-4o-mini");
    assert.equal(MODELS.responder, "gpt-4o-mini");
    assert.match(MODELS.classifierFallback, /^@cf\//);
    assert.match(MODELS.responderFallback, /^@cf\//);
  });

  it("arma el cuerpo de OpenAI con herramientas, formato y sin `name` en mensajes de herramienta", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ choices: [{ message: { content: "hola" } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const run = openAiRunModel("sk-test", fakeFetch);
    const out = await run("gpt-4o-mini", {
      messages: [{ role: "user", content: "hi" }, { role: "tool", tool_call_id: "t", name: "get_menu", content: "{}" }],
      tools: [{ type: "function" }], max_tokens: 600, temperature: 0.2,
    });
    assert.deepEqual(out, { choices: [{ message: { content: "hola" } }] });
    assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(String(calls[0].init.body));
    assert.equal(body.model, "gpt-4o-mini");
    assert.equal(body.max_tokens, 600);
    assert.equal(body.messages[1].name, undefined);
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer sk-test");
  });

  it("si OpenAI falla, cae al modelo de Workers AI con la misma entrada", async () => {
    const used: string[] = [];
    const failingOpenAi = openAiRunModel("sk", (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch);
    const workers = async (model: string) => { used.push(model); return { response: '{"intent":"saludo","confidence":0.8}' }; };
    const run = routedRunModel(workers, failingOpenAi);
    assert.deepEqual(await classify(run, "<mensaje_cliente>hola</mensaje_cliente>", null), { intent: "saludo", confidence: 0.8 });
    assert.deepEqual(used, [MODELS.classifierFallback]);
  });

  it("sin clave de OpenAI también usa el respaldo", async () => {
    const used: string[] = [];
    const run = routedRunModel(async (m) => { used.push(m); return { response: "listo" }; }, openAiRunModel(""));
    assert.equal(await respond(run, { system: "s", history: [], userText: "hola", tools: [] }), "listo");
    assert.deepEqual(used, [MODELS.responderFallback]);
  });

  it("runWithFallback no reintenta si el principal responde", async () => {
    let n = 0;
    await runWithFallback(async () => { n++; return {}; }, "a", "@cf/b", {});
    assert.equal(n, 1);
  });

  it("el cuerpo deja pasar response_format y tool_choice", () => {
    const body = openAiChatBody("gpt-4o-mini", { messages: [], response_format: { type: "json_object" }, tool_choice: "none" });
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.equal(body.tool_choice, "none");
  });
});

describe("carta en PDF", () => {
  it("formatea pesos y agrupa por categoría", () => {
    assert.equal(pesos(3500), "$3.500");
    assert.equal(pesos(1234.5), "$1.234,50");
    const groups = groupForPdf(
      [{ name: "Muzza", price: 12000, category_id: "c1" }, { name: "Agua", price: 1800, category_id: "c2" }, { name: "Suelto", price: 1, category_id: null }],
      [{ id: "c1", name: "Platos Principales" }, { id: "c2", name: "Bebidas" }],
    );
    assert.deepEqual(groups.map((g) => g.name), ["Bebidas", "Platos Principales", "Otros"]);
  });

  it("genera un PDF válido con el nombre del negocio, tildes y todas las páginas", () => {
    const categories = [{ name: "Platos Principales", items: Array.from({ length: 120 }, (_, i) => ({ name: `Pizza número ${i} 🍕`, price: 10000 + i })) }];
    const bytes = renderMenuPdf({ businessName: "La Gambeta", categories, footer: "Precios vigentes" });
    const raw = Buffer.from(bytes).toString("latin1");
    assert.ok(raw.startsWith("%PDF-1.4"));
    assert.ok(raw.trimEnd().endsWith("%%EOF"));
    assert.ok(raw.includes("(La Gambeta)"));
    assert.ok(raw.includes("Pizza n\xFAmero 0"));
    assert.ok(!raw.includes("🍕"));
    const count = Number(/\/Count (\d+)/.exec(raw)?.[1]);
    assert.ok(count >= 3, `páginas: ${count}`);
    // La tabla xref apunta al inicio de cada objeto.
    const startxref = Number(/startxref\n(\d+)/.exec(raw)?.[1]);
    assert.ok(raw.slice(startxref).startsWith("xref"));
    const firstOffset = Number(/0000000000 65535 f \n(\d{10})/.exec(raw)?.[1]);
    assert.ok(raw.slice(firstOffset).startsWith("1 0 obj"));
  });

  it("el cliente de WhatsApp manda el documento y reintenta sin el 9", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      if (bodies.length === 1) return new Response(JSON.stringify({ error: { message: "(#131030) Recipient phone number not in allowed list" } }), { status: 400 });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.doc" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const wa = createWhatsAppClient({ accessToken: "t", phoneNumberId: "p" }, fakeFetch);
    assert.equal(await wa.sendDocument("5491112345678", "https://x/api/public/carta.pdf", "Carta La Gambeta.pdf", "Carta"), "wamid.doc");
    assert.equal(bodies[1].to, "541112345678");
    assert.deepEqual(bodies[1].document, { link: "https://x/api/public/carta.pdf", filename: "Carta La Gambeta.pdf", caption: "Carta" });
    assert.equal(bodies[1].type, "document");
  });
});

describe("turno: pedir la carta", () => {
  function world(lastOut: Date | null) {
    const sent: string[] = [];
    const docs: { url: string; filename: string }[] = [];
    const repo: BotRepo = {
      getConversation: async (phone) => ({ id: "c1", phone, clientId: "cl1", displayName: "Tata", humanTakeover: false }),
      history: async () => [{ direction: "in", body: "el menú?" }],
      inboundCounts: async () => ({ lastMinute: 1, lastDay: 1 }),
      config: async () => ({ agente_activo: true, horario_apertura: "00:00", horario_cierre: "23:59", negocio_nombre: "La Gambeta" }),
      menu: async () => MENU,
      zones: async () => [],
      latestOrder: async () => null,
      setTakeover: async () => {},
      setMarketingOptIn: async () => 1,
      saveOutbound: async (_c, _w, body) => { sent.push(body); },
      saveTranscript: async () => {},
      lastOutboundAt: async () => lastOut,
    };
    const run: TurnDeps["run"] = async (_m, input) => {
      if ("response_format" in input) return { response: JSON.stringify({ intent: "consulta_menu", confidence: 0.95 }) };
      return { response: "🥤 Bebidas\n🍽️ Platos Principales\n¿Querés ver alguna?" };
    };
    let n = 0;
    const deps: TurnDeps = {
      repo, run, transcribe: async () => null, send: async () => `o-${++n}`, appUrl: "https://opsyndely.la-gambeta.com", log: () => {},
      sendDocument: async (_phone, url, filename) => { docs.push({ url, filename }); return "doc-1"; },
    };
    return { sent, docs, send: (text: string) => processTurn({ phone: "5491170000001", text, wamids: ["w1"], audios: [], receivedAt: 0 }, deps) };
  }

  it("manda solo el PDF (URL versionada) y una línea corta, sin la lista en el chat", async () => {
    const w = world(new Date());
    assert.equal(await w.send("me pasás el menú?"), "answered");
    assert.equal(w.docs.length, 1);
    assert.match(w.docs[0].url, /^https:\/\/opsyndely\.la-gambeta\.com\/api\/public\/carta\.pdf\?v=\d{10}$/);
    assert.equal(w.docs[0].filename, "Carta La Gambeta.pdf");
    assert.deepEqual(w.sent, [MENU_PDF_NOTE, MENU_PDF_REPLY]);
  });

  it("si pregunta por una categoría no manda el PDF", async () => {
    const w = world(new Date());
    await w.send("qué pizzas tenés?");
    assert.equal(w.docs.length, 0);
  });
});
