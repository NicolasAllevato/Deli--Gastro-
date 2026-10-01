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
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = buildSeed();
  return g[GLOBAL_KEY];
}

export function resetStore(): void {
  (globalThis as GlobalWithStore)[GLOBAL_KEY] = buildSeed();
}
