import { resetDemoFudo } from "@/lib/demo/fudo-fixture";
import { buildSeed, type Tables } from "@/lib/demo/seed";

/**
 * Base en memoria del modo demo. Vive en `globalThis` para sobrevivir al
 * hot-reload de `next dev` y compartirse entre rutas y server components.
 * No toca disco ni red: al reiniciar el servidor vuelve el seed.
 */
const GLOBAL_KEY = "__deliGastroDemoStore" as const;

type GlobalWithStore = typeof globalThis & { [GLOBAL_KEY]?: Tables };

export function getStore(): Tables {
  const g = globalThis as GlobalWithStore;
  const store = g[GLOBAL_KEY];
  if (!store) {
    g[GLOBAL_KEY] = buildSeed();
    return g[GLOBAL_KEY];
  }
  // Un store creado antes de sumar una tabla (hot-reload) no la tiene: se completa con el seed.
  // Se revisa una vez por carga del módulo (el seed es caro de construir).
  if (!checkedTables) {
    checkedTables = true;
    for (const [name, rows] of Object.entries(buildSeed())) {
      const key = name as keyof Tables;
      if (!store[key]) store[key] = rows;
    }
  }
  return store;
}

let checkedTables = false;

export function resetStore(): void {
  resetDemoFudo();
  (globalThis as GlobalWithStore)[GLOBAL_KEY] = buildSeed();
}
