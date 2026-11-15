import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildResetEmail } from "../src/lib/auth/reset-email.ts";

const URL_BA = "https://opsyndely.la-gambeta.com/api/auth/reset-password/abc123?callbackURL=%2Frestablecer";

describe("buildResetEmail", () => {
  it("no vuelve a codificar el link (callbackURL queda %2F, no %252F)", () => {
    const { html, text } = buildResetEmail(URL_BA);
    assert.ok(html.includes('href="https://opsyndely.la-gambeta.com/api/auth/reset-password/abc123?callbackURL=%2Frestablecer"'));
    assert.ok(!html.includes("%25"));
    assert.ok(text.includes(URL_BA));
  });

  it("escapa caracteres de HTML en el atributo", () => {
    const { html } = buildResetEmail('https://x.test/a?b=1&c="2"');
    assert.ok(html.includes('href="https://x.test/a?b=1&amp;c=&quot;2&quot;"'));
  });
});
