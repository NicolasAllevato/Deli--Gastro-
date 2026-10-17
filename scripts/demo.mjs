// Levanta la plataforma en modo demo: datos de ejemplo en memoria, sin
// Supabase, Cloudflare R2, n8n ni Upstash. Nada se guarda.
//
//   npm run demo            -> http://localhost:5178 (modo desarrollo: compila cada pantalla al abrirla)
//   npm run demo:rapido     -> compila todo una vez y sirve la versión optimizada (pantallas al instante)
//   DEMO_PORT=3000 npm run demo
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const port = process.env.DEMO_PORT ?? "5178";
const fast = process.argv.includes("--rapido");
const DIST_DIR = ".next-demo";

// Variables de servicios externos en blanco: Next no pisa las que ya existen en
// el proceso, así que `.env.local` no puede reactivar ninguna conexión cloud.
const EXTERNAL = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "N8N_WEBHOOK_URL_CHATBOT",
  "N8N_WEBHOOK_URL_ORDERS",
  "N8N_WEBHOOK_URL_REVIEWS",
  "N8N_DISPATCHER_URL",
  "R2_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_BASE_URL",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
];

const env = {
  ...process.env,
  ...Object.fromEntries(EXTERNAL.map((key) => [key, ""])),
  NEXT_PUBLIC_DEMO_MODE: "true",
  ...(fast ? { NEXT_DIST_DIR: DIST_DIR } : {}),
};

/** Fecha de modificación más nueva dentro de una carpeta o archivo. */
function newestMtime(path) {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return readdirSync(path).reduce((max, name) => Math.max(max, newestMtime(join(path, name))), stat.mtimeMs);
}

/** La compilación sirve mientras ningún archivo fuente sea más nuevo que ella. */
function buildIsFresh() {
  const buildId = join(DIST_DIR, "BUILD_ID");
  if (!existsSync(buildId)) return false;
  const built = statSync(buildId).mtimeMs;
  const sources = ["src", "public", "package.json", "next.config.ts", "postcss.config.mjs"];
  return sources.every((p) => newestMtime(p) <= built);
}

if (fast && !buildIsFresh()) {
  console.log("\n  Compilando la demo (solo cuando cambió el código; tarda un par de minutos)...\n");
  const build = spawnSync(process.execPath, [nextBin, "build"], { env, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

console.log(`\n  Deli-Gastro · MODO DEMO${fast ? " (rápido)" : ""}\n  http://localhost:${port}\n  Cuentas: admin / cliente / repartidor (un clic en /login)\n`);

const child = spawn(process.execPath, [nextBin, fast ? "start" : "dev", "-p", port], { env, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
