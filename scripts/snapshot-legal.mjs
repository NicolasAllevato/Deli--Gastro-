// Guarda en docs/meta/ el HTML publicado de las páginas que pide la configuración de la app de Meta
// (privacidad, términos y eliminación de datos). Lo corre el hook pre-commit; también `npm run meta:html`.
// Si no hay red, no falla: deja las copias como estaban.
import { mkdir, readFile, writeFile } from "node:fs/promises";

const ORIGIN = process.env.LEGAL_ORIGIN ?? "https://opsyndely.la-gambeta.com";
const PAGES = ["privacidad", "terminos", "eliminar-datos"];
const OUT = new URL("../docs/meta/", import.meta.url);

await mkdir(OUT, { recursive: true });
for (const page of PAGES) {
  const file = new URL(`${page}.html`, OUT);
  try {
    const res = await fetch(`${ORIGIN}/${page}`, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Next mete ids de build y nonces que cambian en cada deploy: se quitan para que el diff muestre solo el contenido.
    const html = (await res.text()).replace(/\/_next\/static\/[^"']+/g, "/_next/static/…").replace(/ nonce="[^"]*"/g, "");
    const prev = await readFile(file, "utf8").catch(() => null);
    if (prev !== html) await writeFile(file, html);
    console.log(`${page}: ${prev === html ? "sin cambios" : "actualizada"}`);
  } catch (e) {
    console.warn(`${page}: no se pudo bajar (${e instanceof Error ? e.message : e}); queda la copia anterior`);
  }
}
