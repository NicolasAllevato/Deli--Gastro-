// Genera el ícono propio de la app del repartidor (scooter + pin) en todas las densidades Android.
// Uso: node mobile/repartidor/scripts/generar-iconos.mjs  (desde la raíz del repo; usa sharp de la app)
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// sharp vive en el node_modules de la app (raíz del repo), no en mobile/repartidor.
const sharp = createRequire(join(here, "..", "..", "..", "package.json"))("sharp");
const res = join(here, "..", "android", "app", "src", "main", "res");
const BG = "#0B032C";
const ORANGE = "#ff7b00";

// Glifo en un lienzo de 24x24 (scooter de Lucide + pin de ubicación).
const glyph = `
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <g stroke="#ffffff" stroke-width="1.6" transform="translate(0 2.2)">
      <path d="M21 4h-3.5l2 11.05"/>
      <path d="M6.95 17h5.142c.523 0 .95-.406 1.063-.916a6.5 6.5 0 0 1 5.345-5.009"/>
      <circle cx="19.5" cy="17.5" r="2.5"/>
      <circle cx="4.5" cy="17.5" r="2.5"/>
    </g>
    <g transform="translate(3.2 1.2) scale(0.5)" stroke="${ORANGE}" stroke-width="2.6">
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" fill="${ORANGE}" fill-opacity="0.25"/>
      <circle cx="12" cy="10" r="3"/>
    </g>
  </g>`;

const background = `
  <defs><radialGradient id="g" cx="50%" cy="40%" r="65%">
    <stop offset="0%" stop-color="#5b21b6"/><stop offset="100%" stop-color="${BG}"/>
  </radialGradient></defs>`;

/** Ícono completo: fondo + glifo ocupando `scale` del lado. */
function svg({ size, scale, withBg, round }) {
  const g = size * scale;
  const off = (size - g) / 2;
  const shape = round
    ? `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="url(#g)"/>`
    : `<rect width="${size}" height="${size}" rx="${size * 0.18}" fill="url(#g)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${withBg ? background + shape : ""}
    <g transform="translate(${off} ${off}) scale(${g / 24})">${glyph}</g></svg>`;
}

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

async function render(markup, file) {
  mkdirSync(dirname(file), { recursive: true });
  await sharp(Buffer.from(markup)).png().toFile(file);
}

for (const [name, k] of Object.entries(DENSITIES)) {
  const dir = join(res, `mipmap-${name}`);
  const legacy = 48 * k;
  const adaptive = 108 * k;
  await render(svg({ size: legacy, scale: 0.72, withBg: true, round: false }), join(dir, "ic_launcher.png"));
  await render(svg({ size: legacy, scale: 0.68, withBg: true, round: true }), join(dir, "ic_launcher_round.png"));
  // Adaptive: el sistema recorta ~el 66 % central, por eso el glifo va al 50 %.
  await render(svg({ size: adaptive, scale: 0.5, withBg: false }), join(dir, "ic_launcher_foreground.png"));
}

// Ícono de 512 px para tiendas / vista previa.
await render(svg({ size: 512, scale: 0.72, withBg: true, round: false }), join(here, "..", "icono-repartidor-512.png"));
writeFileSync(join(res, "values", "ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`);
console.log("Íconos del repartidor generados.");
