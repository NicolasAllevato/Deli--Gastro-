// Contraste WCAG 2.x de los tokens de color en los dos temas, a partir del CSS real (sin dependencias).
//
//   npm test                                  -> los fallos conocidos salen como "todo" (exit 0)
//   CONTRAST_STRICT=1 node --test tests/contrast.test.ts  -> sin "todo": los fallos conocidos fallan
//
// Casos: sección 2.4 de docs/plan-frontera-ui.md. Cuando un token se arregla hay que borrar su `known`.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";

const TEXT = 4.5;
const UI = 3;

type Rgba = readonly [number, number, number, number];
type Theme = "light" | "dark";
type Tokens = Readonly<Record<string, string>>;

function readCss(): string {
  const appDir = new URL("../src/app/", import.meta.url);
  const stylesDir = new URL("../src/styles/", import.meta.url);
  // La fase 0.5 del plan parte globals.css en src/styles/*.css: el test sirve antes y después.
  const partials = existsSync(stylesDir)
    ? readdirSync(stylesDir)
        .filter((name) => name.endsWith(".css"))
        .sort()
        .map((name) => readFileSync(new URL(name, stylesDir), "utf8"))
    : [];
  return [readFileSync(new URL("globals.css", appDir), "utf8"), ...partials]
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const CSS = readCss();

function declarations(body: string): Record<string, string> {
  return Object.fromEntries(
    body
      .split(";")
      .map((line) => line.trim())
      .filter((line) => line.includes(":"))
      .map((line) => {
        const colon = line.indexOf(":");
        return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
      }),
  );
}

function blocks(selectorPattern: string): Record<string, string> {
  const pattern = new RegExp(`^[ \\t]*${selectorPattern}\\s*\\{([^}]*)\\}`, "gm");
  return [...CSS.matchAll(pattern)].reduce<Record<string, string>>(
    (merged, match) => ({ ...merged, ...declarations(match[1]) }),
    {},
  );
}

const LIGHT: Tokens = { ...blocks("@theme(?:\\s+[a-z]+)?"), ...blocks(":root") };
const DARK: Tokens = { ...LIGHT, ...blocks(':root\\[data-theme="dark"\\]') };
const TOKENS: Record<Theme, Tokens> = { light: LIGHT, dark: DARK };

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Valor de una propiedad en la regla CSS con ese selector exacto. */
function ruleValue(selector: string, property: string): string {
  const value = blocks(escapeRegExp(selector))[property];
  assert.ok(value, `No se encontró ${property} en la regla ${selector}`);
  return value;
}

function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    const channel = (start: number) => Number.parseInt(digits.slice(start, start + 2), 16);
    return [channel(0), channel(2), channel(4), 1];
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (rgb) {
    const [r, g, b, a = 1] = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [r, g, b, a];
  }
  throw new Error(`Color no soportado por el test: ${value}`);
}

function resolve(value: string, theme: Theme): string {
  if (value.startsWith("--")) {
    const token = TOKENS[theme][value];
    assert.ok(token, `Token inexistente en el tema ${theme}: ${value}`);
    return resolve(token, theme);
  }
  const reference = /^var\((--[\w-]+)(?:,[^)]*)?\)$/.exec(value);
  return reference ? resolve(reference[1], theme) : value;
}

function composite(top: Rgba, under: Rgba): Rgba {
  const alpha = top[3];
  const mix = (index: 0 | 1 | 2) => top[index] * alpha + under[index] * (1 - alpha);
  return [mix(0), mix(1), mix(2), 1];
}

function luminance([r, g, b]: Rgba): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function ratio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

interface Pair {
  readonly name: string;
  readonly theme: Theme;
  /** Token (`--x`) o color literal. Si es translúcido se compone sobre `bg`. */
  readonly fg: string;
  /** Token (`--x`) o color literal. Si es translúcido se compone sobre `over`. */
  readonly bg: string;
  readonly over?: string;
  readonly min: number;
  /** Fallo conocido de la línea base: se reporta como "todo". Borrarlo al arreglar el token. */
  readonly known?: string;
}

function measure(pair: Pair): number {
  const base = parseColor(resolve(pair.over ?? pair.bg, pair.theme));
  const bg = composite(parseColor(resolve(pair.bg, pair.theme)), base);
  const fg = composite(parseColor(resolve(pair.fg, pair.theme)), bg);
  return ratio(fg, bg);
}

const GRAY_300 = ruleValue(".text-gray-300", "color");
const BUTTON = ruleValue(".btn-glow", "background");
const SHEEN_GRADIENT = ruleValue(".btn-glow:hover:not(:disabled)", "background");
const SHEEN_MIDPOINT = /(#[0-9a-f]{6})\s+50%/i.exec(SHEEN_GRADIENT)?.[1] ?? "";
const WHITE = "#ffffff";
const TIER_FAINT = "tier faint por debajo de AA (plan 2.4, fase 1 agente A)";
const CONTROL_BORDER = "borde de control por debajo de 3:1, SC 1.4.11 (plan 2.4, fase 1 agente A)";

const BADGES = ["green", "red", "blue", "orange", "yellow"] as const;

const PAIRS: readonly Pair[] = [
  // Tema claro
  { name: "--app-text sobre bg", theme: "light", fg: "--app-text", bg: "--app-bg", min: TEXT },
  { name: "--app-text-muted sobre surface", theme: "light", fg: "--app-text-muted", bg: "--app-surface", min: TEXT },
  { name: "--app-text-muted sobre inset", theme: "light", fg: "--app-text-muted", bg: "--app-inset", min: TEXT },
  { name: "--app-text-subtle sobre inset", theme: "light", fg: "--app-text-subtle", bg: "--app-inset", min: TEXT },
  { name: "--app-text-faint sobre surface", theme: "light", fg: "--app-text-faint", bg: "--app-surface", min: TEXT, known: TIER_FAINT },
  { name: "--app-text-faint sobre bg", theme: "light", fg: "--app-text-faint", bg: "--app-bg", min: TEXT, known: TIER_FAINT },
  { name: "--app-text-faint sobre inset", theme: "light", fg: "--app-text-faint", bg: "--app-inset", min: TEXT, known: TIER_FAINT },
  { name: ".text-gray-300 sobre surface", theme: "light", fg: GRAY_300, bg: "--app-surface", min: TEXT, known: "remapeo fijo de text-gray-300 (plan 2.4)" },
  { name: "--color-text-disabled sobre surface (inactivo, exento de AA; piso del proyecto 3:1)", theme: "light", fg: "--color-text-disabled", bg: "--app-surface", min: UI },
  { name: "brand-olive como texto sobre inset", theme: "light", fg: "--color-brand-olive", bg: "--app-inset", min: TEXT, known: "usar --app-accent-text en texto (plan 2.4)" },
  { name: "--app-accent-text sobre inset", theme: "light", fg: "--app-accent-text", bg: "--app-inset", min: TEXT },
  { name: "brand-gold como texto sobre bg", theme: "light", fg: "--color-brand-gold", bg: "--app-bg", min: TEXT, known: "AA calculado contra un fondo que ya no existe (plan 2.4)" },
  { name: "brand-gold como texto sobre surface", theme: "light", fg: "--color-brand-gold", bg: "--app-surface", min: TEXT, known: "AA calculado contra un fondo que ya no existe (plan 2.4)" },
  { name: "--color-outline sobre surface", theme: "light", fg: "--color-outline", bg: "--app-surface", min: UI, known: CONTROL_BORDER },
  { name: "--app-border efectivo sobre surface", theme: "light", fg: "--app-border", bg: "--app-surface", min: UI, known: CONTROL_BORDER },
  { name: "blanco sobre .btn-glow", theme: "light", fg: WHITE, bg: BUTTON, min: TEXT },
  { name: "blanco en el punto medio del sheen", theme: "light", fg: WHITE, bg: SHEEN_MIDPOINT, min: TEXT, known: "sheen de .btn-glow:hover (plan 2.4, agente D)" },
  // Tema oscuro
  { name: "--app-text sobre surface", theme: "dark", fg: "--app-text", bg: "--app-surface", min: TEXT },
  { name: "--app-text-subtle sobre surface", theme: "dark", fg: "--app-text-subtle", bg: "--app-surface", min: TEXT },
  { name: "--app-text-subtle sobre inset", theme: "dark", fg: "--app-text-subtle", bg: "--app-inset", min: TEXT },
  { name: "--app-text-faint sobre surface", theme: "dark", fg: "--app-text-faint", bg: "--app-surface", min: TEXT, known: TIER_FAINT },
  { name: "--app-text-faint sobre bg", theme: "dark", fg: "--app-text-faint", bg: "--app-bg", min: TEXT, known: TIER_FAINT },
  { name: "--color-outline sobre surface", theme: "dark", fg: "--color-outline", bg: "--app-surface", min: UI, known: CONTROL_BORDER },
  { name: "--app-border efectivo sobre surface", theme: "dark", fg: "--app-border", bg: "--app-surface", min: UI, known: CONTROL_BORDER },
  { name: "--app-accent-text sobre surface", theme: "dark", fg: "--app-accent-text", bg: "--app-surface", min: TEXT },
  { name: "blanco sobre .btn-glow", theme: "dark", fg: WHITE, bg: BUTTON, min: TEXT },
  { name: "blanco en el punto medio del sheen", theme: "dark", fg: WHITE, bg: SHEEN_MIDPOINT, min: TEXT, known: "sheen de .btn-glow:hover (plan 2.4, agente D)" },
  // Badges
  ...BADGES.map((tone): Pair => ({
    name: `.badge-${tone}`,
    theme: "light",
    fg: ruleValue(`.badge-${tone}`, "color"),
    bg: ruleValue(`.badge-${tone}`, "background"),
    min: TEXT,
  })),
  ...BADGES.map((tone): Pair => ({
    name: `.badge-${tone} sobre surface`,
    theme: "dark",
    fg: ruleValue(`:root[data-theme="dark"] .badge-${tone}`, "color"),
    bg: ruleValue(`:root[data-theme="dark"] .badge-${tone}`, "background"),
    over: "--app-surface",
    min: TEXT,
  })),
];

const strict = Boolean(process.env.CONTRAST_STRICT);

describe("fórmula de contraste", () => {
  it("negro sobre blanco da 21:1", () => {
    assert.equal(ratio(parseColor("#000"), parseColor("#fff")), 21);
  });

  it("compone rgba sobre el fondo", () => {
    assert.deepEqual(composite(parseColor("rgba(0, 0, 0, 0.5)"), parseColor("#ffffff")), [127.5, 127.5, 127.5, 1]);
  });
});

for (const theme of ["light", "dark"] as const) {
  describe(`contraste WCAG, tema ${theme}`, () => {
    for (const pair of PAIRS.filter((p) => p.theme === theme)) {
      const todo = pair.known && !strict ? { todo: pair.known } : {};
      it(`${pair.name} >= ${pair.min}:1`, todo, () => {
        const measured = measure(pair);
        // Sin redondear: WCAG no admite redondear hacia arriba para llegar al mínimo.
        assert.ok(measured >= pair.min, `${pair.name}: ${measured.toFixed(2)}:1 (mínimo ${pair.min}:1)`);
      });
    }
  });
}
