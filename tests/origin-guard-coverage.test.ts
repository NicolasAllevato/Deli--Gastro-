import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Los guards reciben `req` opcional para no cambiar su firma, pero llamarlos sin argumento
 * saltea la verificación de origen (CSRF) sin avisar. Este test falla si alguien lo olvida.
 */
const API_DIR = join(import.meta.dirname, "..", "src", "app", "api");
const GUARDS = ["requireAuth", "requireClient", "guardAdmin"];
// requireRole/requireAnyRole siempre llevan argumentos (el rol), así que se chequea el último.
const WITH_ROLE = ["requireRole", "requireAnyRole"];

// Excepciones explícitas (ruta relativa a src/app/api + guard). Vacía a propósito:
// agregar una acá exige justificar por qué esa ruta no necesita verificación de origen.
const EXCEPTIONS = new Set<string>([]);

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

function offenders(source: string): string[] {
  const found: string[] = [];
  for (const g of GUARDS) {
    if (new RegExp(`\\b${g}\\(\\s*\\)`).test(source)) found.push(g);
  }
  for (const g of WITH_ROLE) {
    // requireRole("admin") o requireAnyRole([...]) sin segundo argumento
    if (new RegExp(`\\b${g}\\(\\s*(?:"[a-z]+"|\\[[^\\]]*\\])\\s*\\)`).test(source)) found.push(g);
  }
  return found;
}

describe("cobertura CSRF de los guards", () => {
  it("ninguna ruta llama a un guard sin pasarle req", () => {
    const files = routeFiles(API_DIR);
    assert.ok(files.length > 20, "no se encontraron las rutas de la API");
    const failures = files.flatMap((file) => {
      const rel = file.slice(API_DIR.length + 1).replaceAll("\\", "/");
      return offenders(readFileSync(file, "utf8"))
        .filter((g) => !EXCEPTIONS.has(`${rel}:${g}`))
        .map((g) => `${rel}: ${g}() sin req`);
    });
    assert.deepEqual(failures, []);
  });

  it("el detector reconoce llamadas sin req", () => {
    assert.deepEqual(offenders('await requireAuth();'), ["requireAuth"]);
    assert.deepEqual(offenders('await requireRole("admin");'), ["requireRole"]);
    assert.deepEqual(offenders('await requireAnyRole(["admin", "repartidor"]);'), ["requireAnyRole"]);
    assert.deepEqual(offenders('await guardAdmin(  );'), ["guardAdmin"]);
    assert.deepEqual(offenders('await requireRole("admin", req);'), []);
  });
});
