/** Preguntas frecuentes por archivo (entrega 2): parser puro, vista previa con duplicados y guardado en lote. */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTestDb, seed, actors } from "./helpers/sqlite-d1.ts";
import { ForbiddenError } from "../src/lib/data/actor.ts";
import { createKb, listKb, KB_MAX_ROWS } from "../src/lib/data/kb-negocio.ts";
import { KbCapacityError, previewFaqImport, saveFaqImport } from "../src/lib/data/kb-importar.ts";
import {
  checkFaqFile, faqFileKind, faqKey, FAQ_CLAVES_MAX, FAQ_CONTENIDO_MAX, FAQ_TEMA_MAX, MAX_FAQ_FILE_BYTES, MAX_FAQ_ITEMS, parseFaqFile, splitAnswer,
} from "../src/lib/kb/faq-file.ts";
import { handleFaqImport, type FaqImportDeps } from "../src/lib/kb/faq-import-request.ts";
import { d1BotRepo } from "../workers/whatsapp-bot/src/repo/d1.ts";

const parse = (text: string, name = "faq.txt") => parseFaqFile(name, text);
const temas = (text: string, name?: string) => parse(text, name).items.map((i) => i.tema);

describe("faq-file: tipo y tamaño del archivo", () => {
  it("acepta .txt, .md y .csv (sin importar mayúsculas) y nada más", () => {
    assert.equal(faqFileKind("preguntas.TXT"), "text");
    assert.equal(faqFileKind("preguntas.md"), "text");
    assert.equal(faqFileKind("preguntas.csv"), "csv");
    for (const bad of ["a.xlsx", "a.pdf", "a.txt.exe", "a", "a.js", ".htaccess", "a.csv.html"]) assert.equal(faqFileKind(bad), null, bad);
    assert.equal(parse("P: x\nR: y", "a.pdf").items.length, 0);
    assert.match(parse("P: x\nR: y", "a.pdf").errores[0]!.message, /txt, \.md, \.csv/);
  });

  it("rechaza vacío y más de 200 KB", () => {
    assert.equal(checkFaqFile("a.txt", 100), null);
    assert.equal(checkFaqFile("a.txt", MAX_FAQ_FILE_BYTES), null);
    assert.match(checkFaqFile("a.txt", MAX_FAQ_FILE_BYTES + 1)!, /200 KB/);
    assert.match(checkFaqFile("a.txt", 0)!, /vacío/);
    assert.match(checkFaqFile("a.zip", 10)!, /tiene que ser/);
  });
});

describe("faq-file: bloques P: / R:", () => {
  it("lee P:/R: y Pregunta:/Respuesta: separados por líneas en blanco, con claves", () => {
    const r = parse(
      [
        "P: ¿Hacen envíos?",
        "R: Sí, hasta 5 km.",
        "Claves: delivery, domicilio",
        "",
        "Pregunta: ¿Cómo pago?",
        "Respuesta: Efectivo o Mercado Pago.",
        "",
        "",
        "p: ¿Abren los domingos?",
        "r: Sí.",
      ].join("\n"),
    );
    assert.deepEqual(r.errores, []);
    assert.deepEqual(
      r.items.map((i) => [i.tema, i.contenido, i.palabras_clave]),
      [["¿Hacen envíos?", "Sí, hasta 5 km.", "delivery, domicilio"], ["¿Cómo pago?", "Efectivo o Mercado Pago.", ""], ["¿Abren los domingos?", "Sí.", ""]],
    );
  });

  it("la respuesta puede seguir en varias líneas y las claves se normalizan", () => {
    const r = parse("P: ¿Qué es la fainá?\nR: Es una torta de garbanzos.\nSe come con pizza.\nClaves: faina ,; garbanzo ,  pizza\n");
    assert.equal(r.items[0]!.contenido, "Es una torta de garbanzos.\nSe come con pizza.");
    assert.equal(r.items[0]!.palabras_clave, "faina, garbanzo, pizza");
  });

  it("ignora los comentarios con # y entiende CRLF, BOM y tabulaciones", () => {
    const r = parse("\uFEFF# Preguntas del local\r\n# PENDIENTE: confirmar número\r\n\r\nP:\t¿Horario?\r\nR:\tDe 11 a 23.\r\n# otro comentario\r\n");
    assert.deepEqual(r.errores, []);
    assert.deepEqual(r.items.map((i) => [i.tema, i.contenido]), [["¿Horario?", "De 11 a 23."]]);
  });

  it("informa por línea lo que no se pudo leer y sigue con lo demás", () => {
    const r = parse(["R: huérfana", "", "P: ¿Sin respuesta?", "", "P: ", "R: sin pregunta", "", "texto suelto", "", "P: ¿Bien?", "R: Sí."].join("\n"));
    assert.deepEqual(r.items.map((i) => i.tema), ["¿Bien?"]);
    const byLine = Object.fromEntries(r.errores.map((e) => [e.line, e.message]));
    assert.match(byLine[1]!, /no tiene una pregunta antes/);
    assert.match(byLine[3]!, /no tiene respuesta/);
    assert.match(byLine[5]!, /Falta la pregunta/);
    assert.match(byLine[8]!, /fuera de una pregunta/);
  });

  it("un archivo sin preguntas devuelve un error claro", () => {
    for (const empty of ["", "   \n\n", "# solo comentarios\n# nada más"]) {
      const r = parse(empty);
      assert.equal(r.items.length, 0, JSON.stringify(empty));
      assert.match(r.errores[0]!.message, /No encontré preguntas/);
    }
  });

  it("saca caracteres de control y marcas invisibles", () => {
    const r = parse("P: ¿Hola\u0007?\u200b\nR: Chau\u0000\u202e todo\u0008 bien.");
    assert.equal(r.items[0]!.tema, "¿Hola?");
    assert.equal(r.items[0]!.contenido, "Chau todo bien.");
  });

  it("el texto es texto: no se interpreta nada (HTML y guiones quedan tal cual)", () => {
    const r = parse("P: <script>alert(1)</script>\nR: =1+1 ; DROP TABLE kb_negocio; -- <b>hola</b>");
    assert.equal(r.items[0]!.tema, "<script>alert(1)</script>");
    assert.equal(r.items[0]!.contenido, "=1+1 ; DROP TABLE kb_negocio; -- <b>hola</b>");
  });
});

describe("faq-file: markdown", () => {
  it("«## pregunta» seguido del párrafo de respuesta; el título «# …» se ignora", () => {
    const r = parse("# Preguntas frecuentes\n\n## ¿Aceptan reservas?\nNo tomamos reservas.\n\nSe atiende por orden de llegada.\n\n### ¿Hay estacionamiento?\nSí, frente al local.\nClaves: auto, estacionar\n", "faq.md");
    assert.deepEqual(r.errores, []);
    assert.deepEqual(r.items.map((i) => [i.tema, i.contenido, i.palabras_clave]), [
      ["¿Aceptan reservas?", "No tomamos reservas.\n\nSe atiende por orden de llegada.", ""],
      ["¿Hay estacionamiento?", "Sí, frente al local.", "auto, estacionar"],
    ]);
  });

  it("un encabezado sin respuesta es un error y no frena el resto", () => {
    const r = parse("## ¿Vacía?\n\n## ¿Con respuesta?\nSí.", "faq.md");
    assert.deepEqual(r.items.map((i) => i.tema), ["¿Con respuesta?"]);
    assert.equal(r.errores[0]!.line, 1);
  });
});

describe("faq-file: csv", () => {
  it("lee pregunta, respuesta y palabras_clave (comas, comillas y saltos dentro de la celda)", () => {
    const csv = 'pregunta,respuesta,palabras_clave\n"¿Hacen envíos?","Sí, hasta 5 km.\nTarda 30 min.","delivery, domicilio"\n¿Pagos?,Efectivo,\n';
    const r = parse(csv, "faq.csv");
    assert.deepEqual(r.errores, []);
    assert.deepEqual(r.items.map((i) => [i.tema, i.contenido, i.palabras_clave]), [
      ["¿Hacen envíos?", "Sí, hasta 5 km.\nTarda 30 min.", "delivery, domicilio"],
      ["¿Pagos?", "Efectivo", ""],
    ]);
  });

  it("acepta ; de Excel es-AR, encabezados con tildes y orden distinto, y columnas de más", () => {
    const r = parse("Notas;Respuesta;Pregunta;Palabras clave\nx;Sí.;¿Abren?;horario, abren\n", "faq.csv");
    assert.deepEqual(r.items.map((i) => [i.tema, i.contenido, i.palabras_clave]), [["¿Abren?", "Sí.", "horario, abren"]]);
  });

  it("sin las columnas pregunta y respuesta no carga nada y lo explica", () => {
    const r = parse("a,b\n1,2\n", "faq.csv");
    assert.equal(r.items.length, 0);
    assert.match(r.errores[0]!.message, /pregunta.*respuesta/);
    assert.equal(parse("pregunta,respuesta\n", "faq.csv").errores[0]!.message, "El archivo no tiene filas con preguntas.");
  });

  it("las filas incompletas se informan con su número", () => {
    const r = parse("pregunta,respuesta\n¿Bien?,Sí\n¿Sin respuesta?,\n,huérfana\n", "faq.csv");
    assert.deepEqual(r.items.map((i) => i.tema), ["¿Bien?"]);
    assert.deepEqual(r.errores.map((e) => e.line), [3, 4]);
  });
});

describe("faq-file: topes de la base", () => {
  it("una respuesta de más de 1000 caracteres se parte en «tema (1/2)», «tema (2/2)»", () => {
    const answer = `${"Primera parte del texto. ".repeat(30)}${"Segunda parte del texto. ".repeat(30)}`;
    const r = parse(`P: ¿Cuál es la historia?\nR: ${answer}`);
    assert.ok(answer.length > FAQ_CONTENIDO_MAX);
    assert.deepEqual(r.items.map((i) => i.tema), ["¿Cuál es la historia? (1/2)", "¿Cuál es la historia? (2/2)"]);
    for (const item of r.items) assert.ok(item.contenido.length <= FAQ_CONTENIDO_MAX && item.contenido.length > 0);
    assert.equal(r.items.map((i) => i.contenido).join(" ").replace(/\s+/g, " "), answer.trim().replace(/\s+/g, " "));
    assert.match(r.avisos[0]!.message, /se partió en 2 entradas/);
  });

  it("corta en el fin de una oración o en un espacio, nunca a la mitad de una palabra", () => {
    const parts = splitAnswer(`${"palabra ".repeat(300)}`);
    assert.equal(parts.length, 3);
    for (const p of parts) assert.ok(p.length <= FAQ_CONTENIDO_MAX && /^(palabra ?)+$/.test(p), p.slice(0, 30));
    assert.deepEqual(splitAnswer("corto"), ["corto"]);
    assert.equal(splitAnswer("x".repeat(2500)).length, 3, "sin espacios se corta duro");
  });

  it("una respuesta de más de 5 partes se rechaza", () => {
    const r = parse(`P: ¿Larga?\nR: ${"palabra ".repeat(900)}`);
    assert.equal(r.items.length, 0);
    assert.match(r.errores[0]!.message, /demasiado larga/);
  });

  it("el tema de más de 120 caracteres se recorta, también el de las partes", () => {
    const long = `¿${"a".repeat(200)}?`;
    const one = parse(`P: ${long}\nR: Sí.`);
    assert.equal(one.items[0]!.tema.length, FAQ_TEMA_MAX);
    assert.ok(one.items[0]!.tema.endsWith("…"));
    assert.match(one.avisos[0]!.message, /se recortó/);
    const parts = parse(`P: ${long}\nR: ${"Texto largo. ".repeat(150)}`);
    assert.equal(parts.items.length, 2);
    for (const i of parts.items) assert.ok(i.tema.length <= FAQ_TEMA_MAX && /\(\d\/2\)$/.test(i.tema), i.tema);
  });

  it("las palabras clave se recortan en la última coma que entra en 300 caracteres", () => {
    const claves = Array.from({ length: 80 }, (_, i) => `clave${i}`).join(", ");
    const r = parse(`P: ¿Algo?\nR: Sí.\nClaves: ${claves}`);
    assert.ok(r.items[0]!.palabras_clave.length <= FAQ_CLAVES_MAX);
    assert.match(r.items[0]!.palabras_clave, /clave\d+$/);
    assert.match(r.avisos[0]!.message, /se recortaron/);
  });

  it("máximo 200 preguntas por archivo", () => {
    const text = Array.from({ length: 230 }, (_, i) => `P: Pregunta ${i}\nR: Respuesta ${i}`).join("\n\n");
    const r = parse(text);
    assert.equal(r.items.length, MAX_FAQ_ITEMS);
    assert.equal(r.items.at(-1)!.tema, "Pregunta 199");
    assert.match(r.errores.at(-1)!.message, /supera el tope de 200/);
    assert.equal(parse(Array.from({ length: 200 }, (_, i) => `P: P${i}\nR: R${i}`).join("\n\n")).errores.length, 0);
  });
});

describe("faqKey", () => {
  it("iguala tildes, mayúsculas y signos", () => {
    assert.equal(faqKey("¿Cómo   PAGO?"), "como pago");
    assert.equal(faqKey("Horario de atención"), faqKey("horario de ATENCION!"));
    assert.notEqual(faqKey("pago"), faqKey("pagos"));
  });
});

// ---------- base de datos ----------

let db: ReturnType<typeof createTestDb>;
beforeEach(() => {
  db = createTestDb();
  seed(db);
});

let n = 0;
const nextId = () => `n${++n}`;
const item = (tema: string, contenido = "Respuesta", palabras_clave = "") => ({ tema, contenido, palabras_clave, line: 1 });
const add = (categoria: "faq" | "politica" | "vocabulario", tema: string, contenido = "x") => createKb(db, actors.admin, nextId(), { categoria, tema, contenido });

describe("vista previa: duplicados por tema", () => {
  it("marca lo que ya existe sin importar tildes ni mayúsculas, en cualquier categoría menos vocabulario, y lo repetido en el archivo", async () => {
    await add("faq", "¿Cómo pago?");
    await add("politica", "Horario de atención");
    await add("vocabulario", "La napo");
    const { rows, existentes } = await previewFaqImport(db, actors.admin, [
      item("como pago"), item("HORARIO DE ATENCION!"), item("la napo"), item("Nueva"), item("nueva ?"),
    ]);
    assert.equal(existentes, 3);
    assert.deepEqual(rows.map((r) => [r.duplicado?.categoria ?? null, r.repetido]), [["faq", false], ["politica", false], [null, false], [null, false], [null, true]]);
    assert.equal(rows[0]!.duplicado?.tema, "¿Cómo pago?");
  });

  it("solo staff", async () => {
    await assert.rejects(previewFaqImport(db, actors.ana, [item("x")]), ForbiddenError);
    await assert.rejects(saveFaqImport(db, actors.rep1, [item("x")], { reemplazar: false }, nextId), ForbiddenError);
  });
});

describe("guardar en lote", () => {
  it("inserta como faq, activas, con sus palabras clave, y el agente las encuentra", async () => {
    const out = await saveFaqImport(db, actors.admin, [item("¿Abren los domingos?", "Sí, de 11 a 23.", "domingo, fin de semana"), item("¿Hay estacionamiento?", "Frente al local.")], { reemplazar: false }, nextId);
    assert.deepEqual(out, { insertadas: 2, reemplazadas: 0, salteadas: 0 });
    const all = await listKb(db, actors.admin);
    assert.deepEqual(all.map((e) => [e.categoria, e.activo, e.orden]), [["faq", true, 0], ["faq", true, 0]]);
    const found = await d1BotRepo(db).searchKnowledge!("¿trabajan el fin de semana?");
    assert.deepEqual(found.map((f) => f.topic), ["¿Abren los domingos?"]);
  });

  it("los duplicados se saltean salvo que se pida reemplazar; lo repetido en el archivo siempre", async () => {
    const first = await add("faq", "¿Cómo pago?", "Vieja respuesta");
    await createKb(db, actors.admin, nextId(), { categoria: "faq", tema: "Delivery", contenido: "Viejo", palabras_clave: "envio, moto", activo: false });
    const items = [item("como pago", "Nueva respuesta"), item("delivery", "Nuevo delivery"), item("Otra", "Otra respuesta"), item("otra", "Repetida")];

    const skip = await saveFaqImport(db, actors.admin, items, { reemplazar: false }, nextId);
    assert.deepEqual(skip, { insertadas: 1, reemplazadas: 0, salteadas: 3 });
    assert.equal((await listKb(db, actors.admin)).find((e) => e.id === first.id)!.contenido, "Vieja respuesta");

    const replace = await saveFaqImport(db, actors.admin, items, { reemplazar: true }, nextId);
    // «Otra» se insertó en la primera pasada, así que ahora también es un duplicado a reemplazar; «otra» (repetida en el archivo) se saltea.
    assert.deepEqual(replace, { insertadas: 0, reemplazadas: 3, salteadas: 1 });
    const all = await listKb(db, actors.admin);
    assert.equal(all.find((e) => e.id === first.id)!.contenido, "Nueva respuesta");
    const delivery = all.find((e) => e.tema === "Delivery")!;
    assert.equal(delivery.contenido, "Nuevo delivery");
    assert.equal(delivery.palabras_clave, "envio, moto", "sin claves en el archivo se conservan las que había");
    assert.equal(delivery.activo, false, "reemplazar no reactiva una entrada apagada");
    assert.equal(all.length, 3);
  });

  it("con claves en el archivo, el reemplazo las actualiza", async () => {
    const e = await add("faq", "Horario");
    await saveFaqImport(db, actors.admin, [item("Horario", "11 a 23", "abren, cierran")], { reemplazar: true }, nextId);
    assert.equal((await listKb(db, actors.admin)).find((x) => x.id === e.id)!.palabras_clave, "abren, cierran");
  });

  it("no entran más del tope de entradas: nada se guarda", async () => {
    for (let i = 0; i < KB_MAX_ROWS - 1; i++) await add("faq", `Existente ${i}`);
    await assert.rejects(saveFaqImport(db, actors.admin, [item("Nueva 1"), item("Nueva 2")], { reemplazar: false }, nextId), KbCapacityError);
    assert.equal((await listKb(db, actors.admin)).length, KB_MAX_ROWS - 1);
    const ok = await saveFaqImport(db, actors.admin, [item("Nueva 1")], { reemplazar: false }, nextId);
    assert.equal(ok.insertadas, 1);
  });

  it("vuelve a validar los topes de la base: lo que no entra se saltea", async () => {
    const out = await saveFaqImport(db, actors.admin, [item("x".repeat(121)), item("ok", "y".repeat(1001)), item("bien")], { reemplazar: false }, nextId);
    assert.deepEqual(out, { insertadas: 1, reemplazadas: 0, salteadas: 2 });
  });
});

// ---------- el pedido completo ----------

function deps(): FaqImportDeps {
  return {
    limit: KB_MAX_ROWS,
    preview: (items) => previewFaqImport(db, actors.admin, items),
    save: (items, opts) => saveFaqImport(db, actors.admin, items, opts, nextId),
  };
}

const FILE = "P: ¿Abren los domingos?\nR: Sí.\n\nP: ¿Cómo pago?\nR: Efectivo.\n\nP: ¿Hay estacionamiento?\nR: Sí.";
const call = (body: unknown) => handleFaqImport(body, deps());

describe("POST /importar: modo preview", () => {
  it("devuelve los ítems con su posición, los duplicados marcados y el espacio disponible", async () => {
    await add("faq", "¿Cómo pago?");
    const r = await call({ modo: "preview", nombre: "faq.txt", texto: FILE });
    assert.equal(r.status, 200);
    const items = r.body.items as { indice: number; tema: string; duplicado: unknown }[];
    assert.deepEqual(items.map((i) => [i.indice, i.tema, Boolean(i.duplicado)]), [[0, "¿Abren los domingos?", false], [1, "¿Cómo pago?", true], [2, "¿Hay estacionamiento?", false]]);
    assert.equal(r.body.existentes, 1);
    assert.equal(r.body.limite, KB_MAX_ROWS);
    assert.deepEqual(r.body.errores, []);
    assert.equal((await listKb(db, actors.admin)).length, 1, "la vista previa no guarda nada");
  });

  it("un archivo sin preguntas válidas devuelve 200 con los errores y ningún ítem", async () => {
    const r = await call({ modo: "preview", nombre: "faq.txt", texto: "nada" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.items, []);
    assert.equal((r.body.errores as unknown[]).length, 1);
  });

  it("el contenido del archivo no vuelve en la respuesta más que como ítems ya parseados", async () => {
    const r = await call({ modo: "preview", nombre: "faq.txt", texto: FILE });
    assert.equal("texto" in r.body, false);
  });
});

describe("POST /importar: modo guardar", () => {
  it("guarda solo las elegidas (por posición, sin repetir) y vuelve a leer el archivo en el servidor", async () => {
    const r = await call({ modo: "guardar", nombre: "faq.txt", texto: FILE, seleccion: [2, 0, 2] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { insertadas: 2, reemplazadas: 0, salteadas: 0 });
    assert.deepEqual((await listKb(db, actors.admin)).map((e) => e.tema).sort(), ["¿Abren los domingos?", "¿Hay estacionamiento?"]);
  });

  it("reemplazar actualiza las que ya existen", async () => {
    await add("faq", "¿Cómo pago?", "vieja");
    const r = await call({ modo: "guardar", nombre: "faq.txt", texto: FILE, seleccion: [1], reemplazar: true });
    assert.deepEqual(r.body, { insertadas: 0, reemplazadas: 1, salteadas: 0 });
    assert.equal((await listKb(db, actors.admin))[0]!.contenido, "Efectivo.");
  });

  it("sin selección, o con posiciones que no existen, 400", async () => {
    for (const seleccion of [undefined, [], [3], [-1], [1.5]]) {
      const r = await call({ modo: "guardar", nombre: "faq.txt", texto: FILE, ...(seleccion ? { seleccion } : {}) });
      assert.equal(r.status, 400, JSON.stringify(seleccion));
    }
    assert.equal((await listKb(db, actors.admin)).length, 0);
  });

  it("si no entran por el tope, 409 y no se guarda nada", async () => {
    for (let i = 0; i < KB_MAX_ROWS; i++) await add("faq", `Existente ${i}`);
    const r = await call({ modo: "guardar", nombre: "faq.txt", texto: FILE, seleccion: [0] });
    assert.equal(r.status, 409);
    assert.match(String(r.body.error), /tope/);
    assert.equal((await listKb(db, actors.admin)).length, KB_MAX_ROWS);
  });
});

describe("POST /importar: validaciones", () => {
  it("rechaza cuerpos inválidos, campos de más y modos desconocidos", async () => {
    for (const body of [null, "texto", [], {}, { modo: "borrar", nombre: "a.txt", texto: "x" }, { modo: "preview", nombre: "a.txt" }, { modo: "preview", nombre: "", texto: "x" },
      { modo: "preview", nombre: "a.txt", texto: "x", extra: 1 }, { modo: "preview", nombre: "a.txt", texto: 5 }, { modo: "guardar", nombre: "a.txt", texto: "x", seleccion: ["0"] }]) {
      assert.equal((await call(body)).status, 400, JSON.stringify(body));
    }
  });

  it("valida la extensión del archivo (400) y su tamaño (413)", async () => {
    for (const nombre of ["faq.pdf", "faq.exe", "faq", "../../etc/passwd", "faq.txt.html"]) {
      const r = await call({ modo: "preview", nombre, texto: FILE });
      assert.equal(r.status, 400, nombre);
      assert.match(String(r.body.error), /tiene que ser/);
    }
    // En bytes, no en caracteres: «ñ» ocupa 2.
    const big = await call({ modo: "preview", nombre: "faq.txt", texto: "ñ".repeat(MAX_FAQ_FILE_BYTES / 2 + 1) });
    assert.equal(big.status, 413);
    const tooMany = await call({ modo: "preview", nombre: "faq.txt", texto: "x".repeat(MAX_FAQ_FILE_BYTES + 1) });
    assert.equal(tooMany.status, 400, "el esquema ya corta lo que supera el máximo en caracteres");
    assert.equal((await call({ modo: "preview", nombre: "faq.txt", texto: "P: a\nR: b" })).status, 200);
  });

  it("no confía en el nombre ni en el contenido: nada se ejecuta ni se guarda sin pasar por el parser", async () => {
    const hostile = "P: ');DROP TABLE kb_negocio;--\nR: <img src=x onerror=alert(1)> ${process.env.SECRET} {{7*7}}";
    const r = await call({ modo: "guardar", nombre: "faq.txt", texto: hostile, seleccion: [0] });
    assert.equal(r.status, 200);
    const [saved] = await listKb(db, actors.admin);
    assert.equal(saved!.tema, "');DROP TABLE kb_negocio;--");
    assert.equal(saved!.contenido, "<img src=x onerror=alert(1)> ${process.env.SECRET} {{7*7}}");
    assert.equal((db.raw.prepare("SELECT count(*) AS c FROM kb_negocio").get() as { c: number }).c, 1);
  });
});

describe("la ruta", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

  it("usa el mismo guard de admin (con req, para el CSRF) y un tope por IP más bajo", () => {
    const route = read("src/app/api/admin/conocimiento/importar/route.ts");
    assert.match(route, /guard\(req, 10\)/);
    assert.match(read("src/app/api/admin/conocimiento/route.ts"), /guard\(req, 30\)/);
    assert.match(read("src/app/api/admin/conocimiento/guard.ts"), /requireRole\("admin", req\)/);
    assert.match(read("src/app/api/admin/conocimiento/route.ts"), /from "\.\/guard"/);
    assert.match(route, /from "\.\.\/guard"/);
  });

  it("limita el cuerpo antes de leerlo entero", () => {
    const route = read("src/app/api/admin/conocimiento/importar/route.ts");
    assert.match(route, /content-length/);
    assert.match(route, /MAX_IMPORT_BODY_BYTES/);
    assert.match(route, /status: 413/);
  });
});

describe("modelo descargable", () => {
  it("se lee sin errores y trae ejemplos marcados, sin datos reales", () => {
    const text = readFileSync(new URL("../public/modelos/faq-modelo.txt", import.meta.url), "utf8");
    const r = parseFaqFile("faq-modelo.txt", text);
    assert.deepEqual(r.errores, []);
    assert.equal(r.items.length, 3);
    assert.ok(r.items.every((i) => i.tema.startsWith("[Ejemplo]") && i.contenido.startsWith("[Ejemplo]")));
    assert.equal(r.items[0]!.palabras_clave, "[ejemplo], otra forma de preguntarlo, sinónimo");
  });
});
