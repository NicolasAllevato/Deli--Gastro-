/** Base de conocimiento del negocio (etapa 1): datos D1, prompt del bot y herramienta get_business_info. */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seed, actors } from "./helpers/sqlite-d1.ts";
import { ForbiddenError } from "../src/lib/data/actor.ts";
import { createKb, deleteKb, kbInputSchema, listKb, updateKb } from "../src/lib/data/kb-negocio.ts";
import { d1BotRepo } from "../workers/whatsapp-bot/src/repo/d1.ts";
import { buildResponderPrompt, vocabularyLines } from "../workers/whatsapp-bot/src/bot/prompts.ts";
import { settingsFromConfig } from "../workers/whatsapp-bot/src/bot/settings.ts";

let db: ReturnType<typeof createTestDb>;
beforeEach(() => {
  db = createTestDb();
  seed(db);
});

const faq = { categoria: "faq" as const, tema: "¿Tienen sin TACC?", contenido: "Sí, la pizza de arroz." };
const vocab = { categoria: "vocabulario" as const, tema: "la napo", contenido: "Pizza napolitana grande" };

describe("kb_negocio: datos", () => {
  it("solo staff lista y escribe", async () => {
    await assert.rejects(listKb(db, actors.ana), ForbiddenError);
    await assert.rejects(createKb(db, actors.ana, "k1", faq), ForbiddenError);
    await assert.rejects(deleteKb(db, actors.rep1, "k1"), ForbiddenError);
  });

  it("crea, edita, desactiva y borra", async () => {
    const created = await createKb(db, actors.admin, "k1", faq);
    assert.equal(created.activo, true);
    const edited = await updateKb(db, actors.admin, "k1", { contenido: "Sí, dos opciones.", activo: false });
    assert.equal(edited?.contenido, "Sí, dos opciones.");
    assert.equal(edited?.activo, false);
    assert.equal(await updateKb(db, actors.admin, "nope", { tema: "x" }), null);
    assert.equal(await deleteKb(db, actors.admin, "k1"), true);
    assert.equal((await listKb(db, actors.admin)).length, 0);
  });

  it("rechaza campos no editables y categorías inválidas", async () => {
    await createKb(db, actors.admin, "k1", faq);
    await assert.rejects(updateKb(db, actors.admin, "k1", { id: "otro" } as never), /no editables/);
    assert.equal(kbInputSchema.safeParse({ ...faq, categoria: "secreto" }).success, false);
    assert.equal(kbInputSchema.safeParse({ ...faq, contenido: "x".repeat(1001) }).success, false);
    assert.equal(kbInputSchema.safeParse({ ...faq, extra: 1 }).success, false);
  });
});

describe("kb_negocio: bot", () => {
  it("el repo del bot devuelve solo las activas", async () => {
    await createKb(db, actors.admin, "k1", faq);
    await createKb(db, actors.admin, "k2", vocab);
    await createKb(db, actors.admin, "k3", { ...faq, tema: "Oculta", activo: false });
    const repo = d1BotRepo(db);
    const rows = await repo.knowledge!();
    assert.deepEqual(rows.map((r) => r.topic).sort(), ["la napo", "¿Tienen sin TACC?"]);
  });

  it("el vocabulario va al prompt en una línea y el resto no", () => {
    const entries = [
      { category: "vocabulario" as const, topic: "la\nnapo", content: "Pizza\nnapolitana" },
      { category: "faq" as const, topic: "TACC", content: "Sí" },
    ];
    assert.deepEqual(vocabularyLines(entries), ['- "la napo" → Pizza napolitana']);
    const prompt = buildResponderPrompt(settingsFromConfig({}), "consulta_menu", null, false, entries);
    assert.match(prompt, /Vocabulario de los clientes/);
    assert.doesNotMatch(prompt, /TACC/);
    assert.doesNotMatch(buildResponderPrompt(settingsFromConfig({}), "saludo", null, false), /Vocabulario/);
  });
});
