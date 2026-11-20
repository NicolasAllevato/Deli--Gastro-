// Aborta si algún valor secreto de un archivo env aparece dentro de un directorio de build.
// Uso: node scripts/check-env-leak.mjs .env.local .open-next  (nunca imprime los valores, solo el nombre).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const [envFile, dir] = process.argv.slice(2);
if (!envFile || !dir) {
  console.error("Uso: node scripts/check-env-leak.mjs <archivo env> <directorio>");
  process.exit(2);
}

const PUBLIC = /^(NEXT_PUBLIC_|R2_PUBLIC_BASE_URL$)/;
const secrets = readFileSync(envFile, "utf8")
  .split(/\r?\n/)
  .map((l) => l.match(/^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/))
  .filter(Boolean)
  .map(([, name, raw]) => [name, raw.trim().replace(/^(['"`])([\s\S]*)\1$/, "$2")])
  .filter(([name, value]) => !PUBLIC.test(name) && value.length >= 12);

function* files(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    const s = statSync(p);
    if (s.isDirectory()) yield* files(p);
    else if (s.size < 50 * 1024 * 1024) yield p;
  }
}

const leaks = new Map();
for (const f of files(dir)) {
  const text = readFileSync(f, "latin1");
  for (const [name, value] of secrets) if (text.includes(value)) leaks.set(name, f);
}

if (leaks.size > 0) {
  for (const [name, f] of leaks) console.error(`FILTRACIÓN: el valor de ${name} aparece en ${f}`);
  process.exit(1);
}
console.log(`OK: ${secrets.length} valores secretos revisados, ninguno en ${dir}.`);
