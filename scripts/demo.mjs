// Levanta la plataforma en modo demo: datos de ejemplo en memoria, sin
// Supabase, Cloudflare R2, n8n ni Upstash. Nada se guarda.
//
//   npm run demo            -> http://localhost:5178
//   DEMO_PORT=3000 npm run demo
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const port = process.env.DEMO_PORT ?? "5178";

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
};

console.log(`\n  Deli-Gastro · MODO DEMO\n  http://localhost:${port}\n  Cuentas: admin / cliente / repartidor (un clic en /login)\n`);

const child = spawn(process.execPath, [nextBin, "dev", "-p", port], { env, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
