// Cobertura de los tests unitarios con la herramienta nativa de `node --test` (sin dependencias).
//
//   npm run coverage                      -> informe por archivo de src/lib
//   COVERAGE_MIN_LINES=80 npm run coverage -> además falla si la cobertura de líneas es menor
//
// Node solo informa los archivos que algún test cargó; por eso al final se listan los módulos
// de src/lib que ningún test importa (0 % real) para que no queden ocultos.
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const libDir = join(root, "src", "lib");

function listTs(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listTs(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

const run = spawnSync(
  process.execPath,
  [
    "--no-warnings",
    "--test",
    "--experimental-test-coverage",
    "--test-coverage-include=src/lib/**/*.ts",
    "--test-coverage-exclude=tests/**",
    ...listTs(join(root, "tests")).filter((f) => f.endsWith(".test.ts")),
  ],
  { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

const output = `${run.stdout}${run.stderr}`;
const report = output.slice(output.indexOf("start of coverage report"));
console.log(report.split("\n").map((l) => l.replace(/^ℹ /, "")).join("\n"));

const summary = output.match(/ℹ tests (\d+)[\s\S]*?ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)/);
if (summary) console.log(`Tests: ${summary[1]} total, ${summary[2]} ok, ${summary[3]} con fallas`);

const reported = new Set(
  [...output.matchAll(/ℹ\s+([\w.-]+\.tsx?)\s+\|/g)].map((m) => m[1]),
);
const untested = listTs(libDir)
  .map((f) => relative(root, f).replace(/\\/g, "/"))
  .filter((f) => !reported.has(f.split("/").pop()));
if (untested.length > 0) {
  console.log("\nMódulos de src/lib que ningún test carga (0 % real):");
  for (const f of untested) console.log(`  ${f}`);
}

const total = output.match(/all files\s+\|\s+([\d.]+)/);
const lines = total ? Number(total[1]) : NaN;
const min = Number(process.env.COVERAGE_MIN_LINES ?? 0);
if (run.status !== 0) {
  console.error("\nHay tests que fallan.");
  process.exit(run.status ?? 1);
}
if (min > 0 && !Number.isFinite(lines)) {
  console.error("\nNo se pudo leer el total de cobertura: no se puede verificar el mínimo.");
  process.exit(1);
}
if (Number.isFinite(lines) && lines < min) {
  console.error(`\nCobertura de líneas ${lines}% por debajo del mínimo ${min}%.`);
  process.exit(1);
}
