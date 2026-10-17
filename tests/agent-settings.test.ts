import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDemoDb, setConfig } from "./helpers/demo-db.ts";

const { loadAgentSettings } = await import("../src/lib/agent/settings.ts");

describe("loadAgentSettings · audios", () => {
  it("por defecto recibe y transcribe audios", async () => {
    const { db } = createDemoDb();
    assert.equal((await loadAgentSettings(db)).transcribeAudio, true);
  });

  it("se puede apagar desde la configuración", async () => {
    const { db } = createDemoDb((s) => setConfig(s, "agente_audios", false));
    assert.equal((await loadAgentSettings(db)).transcribeAudio, false);
  });

  it("un valor que no es booleano no lo apaga", async () => {
    const { db } = createDemoDb((s) => setConfig(s, "agente_audios", "no"));
    assert.equal((await loadAgentSettings(db)).transcribeAudio, true);
  });
});
