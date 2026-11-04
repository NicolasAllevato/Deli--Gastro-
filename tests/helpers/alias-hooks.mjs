// Hooks de resolución para que `node --test` entienda el alias `@/` de tsconfig.
// Solo se usa desde los tests (ver alias.ts); la app real lo resuelve con Next.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = new URL("../../src/", import.meta.url);
const WORKERS = new URL("../../workers/", import.meta.url);
const ADMIN_STUB = new URL("./admin-stub.ts", import.meta.url).href;

function candidates(rest) {
  return [rest, `${rest}.ts`, `${rest}/index.ts`];
}

export async function resolve(specifier, context, nextResolve) {
  // `@workers/...`: código de los Workers que la app reutiliza (por ejemplo el plan del sync de Fudo).
  if (specifier.startsWith("@workers/")) {
    for (const candidate of candidates(specifier.slice("@workers/".length))) {
      const url = new URL(candidate, WORKERS);
      if (existsSync(fileURLToPath(url)) && /\.ts$/.test(candidate)) {
        return { url: pathToFileURL(fileURLToPath(url)).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  }
  if (!specifier.startsWith("@/")) return nextResolve(specifier, context);

  const rest = specifier.slice(2);
  // El cliente real de Supabase no se necesita: los tests inyectan su propia base.
  if (rest === "utils/supabase/admin") return { url: ADMIN_STUB, shortCircuit: true };

  for (const candidate of candidates(rest)) {
    const url = new URL(candidate, SRC);
    if (existsSync(fileURLToPath(url)) && /\.ts$/.test(candidate)) {
      return { url: pathToFileURL(fileURLToPath(url)).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
