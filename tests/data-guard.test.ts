/**
 * Guardas estáticas de la capa de datos D1:
 * 1. Nadie fuera de src/lib/data toca el binding D1 ni importa db.ts.
 * 2. Dentro de la capa no se arma SQL con valores interpolados.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");
const DATA = join(SRC, "lib", "data");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name.startsWith(".")) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|js|mjs)$/.test(name) ? [p] : [];
  });
}

const files = walk(SRC);
const outside = files.filter((f) => !f.startsWith(DATA + sep));
const inside = files.filter((f) => f.startsWith(DATA + sep));

describe("binding D1 solo en src/lib/data", () => {
  it("ningún archivo de afuera usa env.DB ni importa la capa de bajo nivel", () => {
    const bad = outside.filter((f) => {
      const s = readFileSync(f, "utf8");
      // Afuera solo se permite `import … from "@/lib/data"` (dataFor(actor)).
      return /\benv\.DB\b|\[["']DB["']\]|D1Database|lib\/data\/[\w-]+(\.ts)?["']/.test(s);
    });
    assert.deepEqual(bad.map((f) => relative(ROOT, f)), []);
  });
  it("solo db.ts usa getCloudflareContext dentro de la capa", () => {
    const bad = inside.filter((f) => !f.endsWith(`${sep}db.ts`) && /getCloudflareContext/.test(readFileSync(f, "utf8")));
    assert.deepEqual(bad, []);
  });
});

describe("consultas parametrizadas", () => {
  it("prepare() no recibe valores interpolados", () => {
    // Se permiten solo interpolaciones de constantes de la capa (COLS, where,
    // COURIER_SCOPE, sets de lista blanca, table de lista blanca).
    const ALLOWED = /^\$\{(COLS|PRODUCT_COLS|CATEGORY_COLS|CLIENT_ORDER_COLS|where|COURIER_SCOPE|table|sets\.join\(", "\)|cols\.join\(", "\)|cols\.map\(\(\) => "\?"\)\.join\(", "\))\}$/;
    const offenders: string[] = [];
    for (const f of inside) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/prepare\(\s*`([\s\S]*?)`/g)) {
        for (const expr of m[1].match(/\$\{[^}]*\}/g) ?? []) {
          if (!ALLOWED.test(expr)) offenders.push(`${relative(ROOT, f)}: ${expr}`);
        }
      }
      if (/prepare\([^)`"']*\+/.test(src)) offenders.push(`${relative(ROOT, f)}: concatenación`);
    }
    assert.deepEqual(offenders, []);
  });
});
