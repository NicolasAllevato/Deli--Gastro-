/**
 * Exporta de la D1 de producción, SOLO LECTURA (SELECT), lo que el bot necesita para armar el menú:
 *   node --no-warnings scripts/simulador/exportar-datos-reales.ts
 * Escribe scripts/simulador/datos-reales/datos.json (gitignored). NO exporta clients, orders ni mensajes.
 * Requiere sesión de wrangler en la cuenta del proyecto (CLOUDFLARE_ACCOUNT_ID=e7351dd776e005da826ba6f2a5aae4c1).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../../", import.meta.url);
const OUT = new URL("datos-reales/", new URL("./", import.meta.url));

/** Cada consulta es un SELECT fijo: nada de lo que entra por parámetros llega al SQL. */
const CONSULTAS: Readonly<Record<string, string>> = {
  categories: "SELECT * FROM categories",
  products: "SELECT * FROM products",
  carta_secciones: "SELECT * FROM carta_secciones",
  carta_items: "SELECT * FROM carta_items",
  fudo_modifier_groups: "SELECT * FROM fudo_modifier_groups",
  fudo_modifier_options: "SELECT * FROM fudo_modifier_options",
  fudo_product_groups: "SELECT * FROM fudo_product_groups",
  global_config: "SELECT * FROM global_config WHERE key NOT LIKE '%token%' AND key NOT LIKE '%secret%' AND key NOT LIKE '%key%' AND key <> 'bot_orders_allowlist'",
  kb_negocio: "SELECT * FROM kb_negocio WHERE activo = 1",
  delivery_zones: "SELECT * FROM delivery_zones",
};

function consultar(sql: string): Record<string, unknown>[] {
  // Con shell (Windows) los argumentos con espacios se parten: la consulta va entre comillas y la config con ruta relativa.
  const out = execFileSync(
    "npx", ["wrangler", "d1", "execute", "deli-gastro", "--remote", "--config", "workers/whatsapp-bot/wrangler.toml", "--json", "--command", `"${sql}"`],
    { encoding: "utf8", cwd: fileURLToPath(ROOT), shell: process.platform === "win32", env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: "e7351dd776e005da826ba6f2a5aae4c1", CLOUDFLARE_API_TOKEN: "" }, maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = JSON.parse(out) as { results: Record<string, unknown>[] }[];
  return parsed[0]?.results ?? [];
}

mkdirSync(OUT, { recursive: true });
const datos: Record<string, Record<string, unknown>[]> = {};
for (const [tabla, sql] of Object.entries(CONSULTAS)) {
  datos[tabla] = consultar(sql);
  console.log(`${tabla}: ${datos[tabla].length} filas`);
}
writeFileSync(new URL("datos.json", OUT), JSON.stringify(datos, null, 1));
console.log("Listo: scripts/simulador/datos-reales/datos.json");
