/** Índice de búsqueda de la base de conocimiento (migración 0022): consulta FTS5, repo del bot y get_business_info con `tema`. */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createTestDb, seed, actors } from "./helpers/sqlite-d1.ts";
import { createKb, deleteKb, kbInputSchema, listKb, updateKb } from "../src/lib/data/kb-negocio.ts";
import { d1BotRepo } from "../workers/whatsapp-bot/src/repo/d1.ts";
import { buildFtsQuery, escapeLike, likePatterns, searchTerms, stem, MAX_TERMS } from "../workers/whatsapp-bot/src/repo/kb-search.ts";
import { toolsFor } from "../workers/whatsapp-bot/src/bot/tools.ts";
import { settingsFromConfig } from "../workers/whatsapp-bot/src/bot/settings.ts";
import type { BotConversation, BotRepo } from "../workers/whatsapp-bot/src/repo/types.ts";

let db: ReturnType<typeof createTestDb>;
beforeEach(() => {
  db = createTestDb();
  seed(db);
});

let n = 0;
const add = (categoria: "faq" | "politica" | "promo" | "vocabulario" | "otro", tema: string, contenido: string, extra: { palabras_clave?: string; activo?: boolean; orden?: number } = {}) =>
  createKb(db, actors.admin, `k${++n}`, { categoria, tema, contenido, ...extra });

describe("kb-search: consulta FTS5", () => {
  it("tokeniza sin tildes ni mayúsculas, con prefijo y unida por OR", () => {
    assert.equal(buildFtsQuery("¿A qué HORA abren los Domingos?"), '"hora"* OR "abren"* OR "doming"*');
    assert.equal(buildFtsQuery("Pizzería"), '"pizzeri"*');
  });

  it("saca las palabras vacías y devuelve null si no queda nada", () => {
    assert.equal(buildFtsQuery("hola que tal"), null);
    assert.equal(buildFtsQuery("hola, tienen sin TACC?"), '"tacc"*');
    assert.equal(buildFtsQuery("hola, ¿qué tienen? por favor"), null);
    assert.equal(buildFtsQuery(""), null);
    assert.equal(buildFtsQuery("   ¿¡?!   "), null);
  });

  it("los términos de 2 letras van exactos y los de 1 se descartan", () => {
    assert.equal(buildFtsQuery("5 km"), '"km"');
    assert.equal(buildFtsQuery("a 5"), null);
  });

  it("escapa comillas y operadores de FTS5: nunca llegan como sintaxis", () => {
    const q = buildFtsQuery('"; DROP TABLE kb_negocio; -- NEAR(a b) col:tema AND OR NOT *')!;
    assert.ok(!/[;()*:-]/.test(q.replaceAll('"*', "").replaceAll(" OR ", "")), q);
    // Cada término queda entre comillas: AND/NOT/NEAR son palabras literales, no operadores.
    for (const part of q.split(" OR ")) assert.match(part, /^"[\p{L}\p{N}]+"\*?$/u, part);
  });

  it("deduplica, aplica el stem y acota la cantidad de términos", () => {
    assert.deepEqual(searchTerms("cancelo cancelar cancelación"), ["cancel", "cancelacion"]);
    assert.deepEqual(searchTerms("zonas zona"), ["zona"]);
    assert.equal(searchTerms("uno1 dos2 tres3 cuat4 cinc5 seis6 siet7 ocho8 nuev9 diez10 once11").length, MAX_TERMS);
    assert.equal(stem("horarios"), "horari");
    assert.equal(stem("envios"), "envio");
  });

  it("el respaldo LIKE escapa %, _ y la barra", () => {
    assert.equal(escapeLike("50%_off\\"), "50\\%\\_off\\\\");
    assert.deepEqual(likePatterns("descuento 100%"), ["%descuent%", "%100%"]);
  });
});

describe("kb_negocio_fts: índice sincronizado por triggers", () => {
  it("encuentra por tema, contenido y palabras clave, sin importar tildes ni mayúsculas", async () => {
    await add("faq", "Horario de atención", "Abrimos todos los días de 11 a 23.", { palabras_clave: "abren, cierran, hora" });
    await add("politica", "Cancelaciones", "Se puede cancelar dentro de los 20 minutos.");
    const repo = d1BotRepo(db);
    assert.deepEqual((await repo.searchKnowledge!("a qué hora cierran?")).map((r) => r.topic), ["Horario de atención"]);
    assert.deepEqual((await repo.searchKnowledge!("ATENCION")).map((r) => r.topic), ["Horario de atención"]);
    assert.deepEqual((await repo.searchKnowledge!("puedo cancelar?")).map((r) => r.topic), ["Cancelaciones"]);
    assert.deepEqual((await repo.searchKnowledge!("sushi")).map((r) => r.topic), []);
  });

  it("no devuelve vocabulario ni entradas desactivadas", async () => {
    await add("vocabulario", "la napo", "Pizza napolitana grande");
    await add("faq", "Napolitana oculta", "Pizza napolitana con ajo", { activo: false });
    await add("faq", "Pizza napolitana", "Lleva tomate, mozzarella y ajo.");
    const found = await d1BotRepo(db).searchKnowledge!("napolitana");
    assert.deepEqual(found.map((r) => r.topic), ["Pizza napolitana"]);
  });

  it("el tema y las palabras clave pesan más que el contenido", async () => {
    await add("faq", "Formas de pago", "Aceptamos efectivo. Si querés tarjeta consultá antes.");
    await add("faq", "Tarjeta de crédito", "No aceptamos crédito por ahora.");
    const found = await d1BotRepo(db).searchKnowledge!("tarjeta");
    assert.deepEqual(found.map((r) => r.topic), ["Tarjeta de crédito", "Formas de pago"]);
  });

  it("respeta el tope de resultados (8 por defecto)", async () => {
    for (let i = 0; i < 12; i++) await add("faq", `Pregunta de envío ${i}`, "Envíos a domicilio.");
    const repo = d1BotRepo(db);
    assert.equal((await repo.searchKnowledge!("envios")).length, 8);
    assert.equal((await repo.searchKnowledge!("envios", 3)).length, 3);
  });

  it("al editar, activar o borrar el índice se mantiene al día", async () => {
    const entry = await add("faq", "Horario", "Abrimos de 11 a 23.");
    const repo = d1BotRepo(db);
    await updateKb(db, actors.admin, entry.id, { tema: "Atención al público", palabras_clave: "domingos" });
    assert.deepEqual(await repo.searchKnowledge!("horario"), [], "el tema viejo ya no está en el índice");
    assert.deepEqual((await repo.searchKnowledge!("domingos")).map((r) => r.topic), ["Atención al público"]);
    assert.deepEqual((await repo.searchKnowledge!("publico")).map((r) => r.topic), ["Atención al público"]);
    await updateKb(db, actors.admin, entry.id, { activo: false });
    assert.deepEqual(await repo.searchKnowledge!("publico"), []);
    await updateKb(db, actors.admin, entry.id, { activo: true });
    assert.equal((await repo.searchKnowledge!("publico")).length, 1);
    await deleteKb(db, actors.admin, entry.id);
    assert.deepEqual(await repo.searchKnowledge!("publico"), []);
    assert.equal((db.raw.prepare("SELECT count(*) AS c FROM kb_negocio_fts").get() as { c: number }).c, 0);
  });

  it("sin consulta útil devuelve unas pocas entradas generales (ordenadas por orden)", async () => {
    for (let i = 0; i < 8; i++) await add("faq", `Tema ${i}`, "x", { orden: 8 - i });
    await add("vocabulario", "jerga", "algo");
    const repo = d1BotRepo(db);
    const none = await repo.searchKnowledge!("");
    assert.equal(none.length, 5);
    assert.deepEqual(none.map((r) => r.topic), ["Tema 7", "Tema 6", "Tema 5", "Tema 4", "Tema 3"]);
    assert.equal((await repo.searchKnowledge!("hola, qué tal por favor?")).length, 5);
    assert.ok(!(await repo.searchKnowledge!()).some((r) => r.category === "vocabulario"));
  });

  it("una consulta con comillas y operadores no rompe ni inyecta", async () => {
    await add("faq", "Pagos", "Efectivo y Mercado Pago.");
    const logs: unknown[] = [];
    const repo = d1BotRepo(db, (m, d) => logs.push([m, d]));
    for (const q of ['" OR 1=1 --', "pagos NEAR(a b) AND", "tema:pagos", "(((", "'; DROP TABLE kb_negocio; --"]) {
      await assert.doesNotReject(repo.searchKnowledge!(q), q);
    }
    assert.equal((await repo.searchKnowledge!("pagos'); DROP TABLE kb_negocio;--")).length, 1);
    assert.equal(logs.length, 0, "no debería haber caído al respaldo");
    assert.equal((db.raw.prepare("SELECT count(*) AS c FROM kb_negocio").get() as { c: number }).c, 1);
  });

  it("si FTS falla, avisa en el log y busca con LIKE", async () => {
    await add("faq", "Pagos", "Efectivo y Mercado Pago.");
    await add("faq", "100% natural", "La masa es 100% casera.");
    await add("vocabulario", "pagos", "jerga");
    db.raw.exec("DROP TABLE kb_negocio_fts");
    const logs: { message: string; detail: unknown }[] = [];
    const repo = d1BotRepo(db, (message, detail) => logs.push({ message, detail }));
    assert.deepEqual((await repo.searchKnowledge!("pagos")).map((r) => r.topic), ["Pagos"]);
    assert.equal(logs.length, 1);
    assert.match(logs[0]!.message, /FTS/);
    // El % del cliente es un carácter, no un comodín.
    assert.deepEqual((await repo.searchKnowledge!("100%")).map((r) => r.topic), ["100% natural"]);
  });
});

describe("kb_negocio.palabras_clave", () => {
  it("se guarda, se edita y se valida a 300 caracteres", async () => {
    const created = await add("faq", "Horario", "11 a 23", { palabras_clave: "abren, cierran" });
    assert.equal(created.palabras_clave, "abren, cierran");
    assert.equal((await add("faq", "Sin claves", "x")).palabras_clave, "");
    const edited = await updateKb(db, actors.admin, created.id, { palabras_clave: "hora" });
    assert.equal(edited?.palabras_clave, "hora");
    assert.equal((await listKb(db, actors.admin)).find((e) => e.id === created.id)?.palabras_clave, "hora");
    const base = { categoria: "faq" as const, tema: "t", contenido: "c" };
    assert.equal(kbInputSchema.safeParse({ ...base, palabras_clave: "x".repeat(300) }).success, true);
    assert.equal(kbInputSchema.safeParse({ ...base, palabras_clave: "x".repeat(301) }).success, false);
  });
});

describe("migración 0022 sobre datos existentes", () => {
  it("indexa las filas que ya había y agrega la columna palabras_clave vacía", () => {
    const dir = new URL("../d1/migrations/", import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const raw = new DatabaseSync(":memory:");
    raw.exec(readFileSync(new URL("../d1/schema/0001_inicial.sql", import.meta.url), "utf8"));
    for (const f of files.filter((f) => f < "0022")) raw.exec(readFileSync(new URL(f, dir), "utf8"));
    raw.prepare("INSERT INTO kb_negocio (id, categoria, tema, contenido) VALUES (?, ?, ?, ?)").run("a", "faq", "Horario", "Abrimos de 11 a 23");
    raw.prepare("INSERT INTO kb_negocio (id, categoria, tema, contenido) VALUES (?, ?, ?, ?)").run("b", "politica", "Cancelación", "Hasta 20 minutos");
    raw.exec(readFileSync(new URL("0022_kb_negocio_fts.sql", dir), "utf8"));
    const rows = raw.prepare("SELECT id, palabras_clave FROM kb_negocio ORDER BY id").all() as { id: string; palabras_clave: string }[];
    assert.deepEqual(rows.map((r) => [r.id, r.palabras_clave]), [["a", ""], ["b", ""]]);
    const hits = raw.prepare("SELECT id FROM kb_negocio_fts WHERE kb_negocio_fts MATCH ? ORDER BY id").all('"cancelacion"*') as { id: string }[];
    assert.deepEqual(hits.map((r) => r.id), ["b"]);
    assert.equal((raw.prepare("SELECT count(*) AS c FROM kb_negocio_fts").get() as { c: number }).c, 2);
  });
});

describe("get_business_info: filtra por tema", () => {
  const conversation: BotConversation = { id: "c1", phone: "5491100000001", clientId: null, displayName: null, humanTakeover: false };
  const settings = settingsFromConfig({ negocio_nombre: "La Gambeta", horario_apertura: "11:00", horario_cierre: "23:00" });
  const tool = (repo: BotRepo, log?: (m: string, d?: unknown) => void) =>
    toolsFor("consulta_local", repo, conversation, settings, () => Date.parse("2026-11-20T15:00:00Z"), undefined, undefined, log).find((t) => t.name === "get_business_info")!;
  type Info = { knowledge: { topic: string }[]; knowledge_note?: string; hours: unknown; payment_methods: string[]; zones: unknown[] };

  it("el esquema pide `tema` y lo describe", () => {
    const t = tool(d1BotRepo(db));
    const params = t.parameters as { required: string[]; properties: { tema: { type: string; description: string } } };
    assert.deepEqual(params.required, ["tema"]);
    assert.equal(params.properties.tema.type, "string");
    assert.match(params.properties.tema.description, /cliente pregunta/);
  });

  it("devuelve solo las entradas del tema y los datos fijos del local", async () => {
    await add("faq", "Horario de atención", "Abrimos de 11 a 23.", { palabras_clave: "abren" });
    await add("politica", "Cancelaciones", "Dentro de los 20 minutos.");
    await add("vocabulario", "la napo", "Pizza napolitana");
    const out = (await tool(d1BotRepo(db)).run({ tema: "cómo cancelo mi pedido" })) as Info;
    assert.deepEqual(out.knowledge.map((k) => k.topic), ["Cancelaciones"]);
    assert.deepEqual(out.hours, { open: "11:00", close: "23:00" });
    assert.ok(out.payment_methods.length > 0);
    assert.equal(out.knowledge_note, undefined);
  });

  it("sin coincidencias avisa que no hay nada cargado (para no inventar)", async () => {
    await add("faq", "Horario", "11 a 23");
    const out = (await tool(d1BotRepo(db)).run({ tema: "tienen sushi" })) as Info;
    assert.deepEqual(out.knowledge, []);
    assert.match(out.knowledge_note ?? "", /sushi/);
    assert.match(out.knowledge_note ?? "", /no lo inventes/);
    assert.match(out.knowledge_note ?? "", /handoff_to_human con motivo "consulta"/);
  });

  it("si el tema nombra algo que está en el menú (sin tacc), devuelve esos productos y no manda a derivar", async () => {
    const menu = [
      { id: "p1", name: "Pizza de harina de arroz (sin TACC)", description: null, price: 15000, category: "Pizzas" },
      { id: "p2", name: "Muzzarella grande", description: null, price: 12500, category: "Pizzas" },
    ];
    const repo: BotRepo = { ...d1BotRepo(db), menu: async () => menu };
    const out = (await tool(repo).run({ tema: "ola tenes algo sin tacc" })) as Info & { menu_matches?: { name: string; price_text: string }[] };
    assert.deepEqual(out.menu_matches?.map((m) => m.name), ["Pizza de harina de arroz (sin TACC)"]);
    assert.match(out.menu_matches?.[0]?.price_text ?? "", /15\.000/);
    assert.equal(out.knowledge_note, undefined);
  });

  it("un tema que no está ni en el conocimiento ni en el menú sigue avisando que no hay nada cargado", async () => {
    const repo: BotRepo = { ...d1BotRepo(db), menu: async () => [{ id: "p2", name: "Muzzarella grande", description: null, price: 12500, category: "Pizzas" }] };
    const out = (await tool(repo).run({ tema: "tienen sushi" })) as Info & { menu_matches?: unknown[] };
    assert.deepEqual(out.menu_matches ?? [], []);
    assert.match(out.knowledge_note ?? "", /sushi/);
  });

  it("sin `tema` devuelve unas pocas entradas generales y no falla", async () => {
    for (let i = 0; i < 7; i++) await add("faq", `Tema ${i}`, "x");
    const out = (await tool(d1BotRepo(db)).run({})) as Info;
    assert.equal(out.knowledge.length, 5);
    assert.equal(out.knowledge_note, undefined);
  });

  it("si la búsqueda falla no se traga el error: lo registra y responde sin entradas", async () => {
    const repo: BotRepo = {
      ...d1BotRepo(db),
      searchKnowledge: async () => {
        throw new Error("D1 caído");
      },
    };
    const logs: { message: string; detail: unknown }[] = [];
    const out = (await tool(repo, (message, detail) => logs.push({ message, detail })).run({ tema: "horario" })) as Info;
    assert.deepEqual(out.knowledge, []);
    assert.equal(logs.length, 1);
    assert.match(logs[0]!.message, /get_business_info/);
    assert.deepEqual(logs[0]!.detail, { error: "D1 caído" });
  });
});

describe("vocabulary(): glosario del prompt", () => {
  it("solo trae la categoría vocabulario activa, con tope de 30", async () => {
    for (let i = 0; i < 35; i++) await add("vocabulario", `término ${String(i).padStart(2, "0")}`, "significa algo");
    await add("vocabulario", "apagado", "x", { activo: false });
    await add("faq", "Una pregunta", "Una respuesta");
    const vocab = await d1BotRepo(db).vocabulary!();
    assert.equal(vocab.length, 30);
    assert.ok(vocab.every((v) => v.category === "vocabulario"));
    assert.ok(!vocab.some((v) => v.topic === "apagado"));
  });
});
