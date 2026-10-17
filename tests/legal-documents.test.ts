import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LEGAL_BUNDLE_VERSION,
  LEGAL_DOCUMENTS,
  isLegalDocumentId,
  legalStatus,
  safeRedirect,
} from "../src/lib/legal/documents.ts";

const v = (id: string) => LEGAL_DOCUMENTS.find((d) => d.id === id)!.version;

describe("documentos legales", () => {
  it("hay dos documentos separados: términos y privacidad", () => {
    assert.deepEqual(LEGAL_DOCUMENTS.map((d) => d.id), ["terminos", "privacidad"]);
  });

  it("la versión del paquete cambia si cambia la de un documento", () => {
    assert.ok(LEGAL_BUNDLE_VERSION.includes(v("terminos")));
    assert.ok(LEGAL_BUNDLE_VERSION.includes(v("privacidad")));
  });

  it("sin aceptaciones, los dos quedan pendientes", () => {
    const s = legalStatus([]);
    assert.equal(s.complete, false);
    assert.deepEqual(s.pending, ["terminos", "privacidad"]);
  });

  it("aceptar uno solo no alcanza", () => {
    const s = legalStatus([{ document: "terminos", version: v("terminos"), accepted_at: "2026-10-14T10:00:00Z" }]);
    assert.equal(s.complete, false);
    assert.deepEqual(s.pending, ["privacidad"]);
    assert.equal(s.accepted.terminos, "2026-10-14T10:00:00Z");
  });

  it("una versión vieja no cuenta como aceptada", () => {
    const s = legalStatus([
      { document: "terminos", version: "1999-01-01", accepted_at: "2026-01-01T00:00:00Z" },
      { document: "privacidad", version: v("privacidad"), accepted_at: "2026-10-14T10:00:00Z" },
    ]);
    assert.deepEqual(s.pending, ["terminos"]);
  });

  it("con las dos versiones vigentes queda completo", () => {
    const s = legalStatus([
      { document: "terminos", version: v("terminos"), accepted_at: "2026-10-14T10:00:00Z" },
      { document: "privacidad", version: v("privacidad"), accepted_at: "2026-10-14T10:01:00Z" },
    ]);
    assert.equal(s.complete, true);
    assert.deepEqual(s.pending, []);
  });

  it("valida el id de documento", () => {
    assert.equal(isLegalDocumentId("terminos"), true);
    assert.equal(isLegalDocumentId("cookies"), false);
    assert.equal(isLegalDocumentId(42), false);
  });

  it("solo redirige a rutas internas", () => {
    assert.equal(safeRedirect("/cliente/pedidos"), "/cliente/pedidos");
    assert.equal(safeRedirect("//evil.com"), "/");
    assert.equal(safeRedirect("https://evil.com"), "/");
    assert.equal(safeRedirect("/\\evil.com"), "/");
    assert.equal(safeRedirect(null), "/");
  });
});
