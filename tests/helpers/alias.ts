import { register } from "node:module";

// Importar este archivo ANTES de importar (con `await import`) módulos de `src/` que usen `@/...`.
register("./alias-hooks.mjs", import.meta.url);
