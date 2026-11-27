/**
 * Sugerencias de vínculo entre los productos de la app (Fudo) y la carta del sitio web. Función pura: no toca red ni base.
 * Las sugerencias son solo eso: las confirma una persona en /admin/sitio antes de guardarse.
 */
import type { SiteCategory, SitePromotion } from "./schemas.ts";

export type Confidence = "alta" | "media" | "baja";

export interface AppProductInput {
  id: string;
  name: string;
  /** Nombre de la categoría de la app; «Promos» se compara contra las promociones del sitio. */
  categoryName?: string | null;
}

export interface MatchSuggestion {
  appProductId: string;
  kind: "product" | "promotion";
  siteId: string;
  siteVariantId: string | null;
  siteLabel: string;
  confidence: Confidence;
}

type VariantHint = "entera" | "porcion" | "unidad" | null;

/** Minúsculas, sin acentos ni puntuación (se conserva «/» por «1/4» y «con/sin»). */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Quita «(...)» pero rescata lo que indica tamaño: «Lata 473» → lata, «1L» → litro. */
function stripParens(raw: string): { text: string; sizeTokens: string[] } {
  const sizeTokens: string[] = [];
  const text = raw.replace(/\(([^)]*)\)/g, (_, inner: string) => {
    const n = normalize(inner);
    if (/\blata\b/.test(n)) sizeTokens.push("lata");
    if (/\b1 ?l\b|\blitro\b/.test(n)) sizeTokens.push("litro");
    return " ";
  });
  return { text, sizeTokens };
}

/** Nombres completos que no siguen la regla de prefijos (clave: nombre ya normalizado). */
const WHOLE_NAME_SYNONYMS: Readonly<Record<string, string>> = {
  "tostado jamon y queso": "tostado de jyq pan de miga",
  "tostado de jamon y queso": "tostado de jyq pan de miga",
  "tostado de jamon y queso 1/2 porcion": "medio tostado de jyq",
  "medialuna de jamon y queso": "medialuna de jyq",
  "pepsi chica": "gaseosa chica linea pepsi",
  "pepsi grande": "gaseosa linea pepsi",
  "postre helado 1/4": "1/4 de helado",
  "agua con gas": "agua con/sin gas",
  "agua sin gas": "agua con/sin gas",
};

/** Nombre sin prefijo de tamaño/tipo → nombre en el sitio. */
const CORE_SYNONYMS: Readonly<Record<string, string>> = {
  "jamon y morrones": "jamon y morron",
  fugazzeta: "fugazzeta rellena",
  cancha: "pizza de cancha",
  carne: "carne suave",
  faina: "faina clasica",
  "budin de pan": "budin de pan",
  "nicasia malbec": "nicasia",
  "stella artois": "stella",
  "stella artois litro": "stella litro",
  "andes rubia lata": "andes lata",
  "andes rubia litro": "andes litro",
  "andes rubia": "andes",
};

const PREFIXES: ReadonlyArray<{ prefix: string; hint: VariantHint }> = [
  { prefix: "grande de ", hint: "entera" },
  { prefix: "grande ", hint: "entera" },
  { prefix: "gde ", hint: "entera" },
  { prefix: "porcion de ", hint: "porcion" },
  { prefix: "porcion ", hint: "porcion" },
  { prefix: "empanada de ", hint: "unidad" },
  { prefix: "empanada ", hint: "unidad" },
];

export interface ParsedName {
  core: string;
  hint: VariantHint;
}

/** Nombre de la app → nombre buscado en el sitio y pista de variante. */
export function parseAppName(raw: string): ParsedName {
  const { text, sizeTokens } = stripParens(raw);
  let n = normalize(`${text} ${sizeTokens.join(" ")}`);
  const whole = WHOLE_NAME_SYNONYMS[n];
  if (whole) return { core: whole, hint: null };
  let hint: VariantHint = null;
  for (const p of PREFIXES) {
    if (n.startsWith(p.prefix)) {
      n = n.slice(p.prefix.length).trim();
      hint = p.hint;
      break;
    }
  }
  n = n.replace(/\b1 ?l\b/g, "litro").replace(/\s+/g, " ").trim();
  return { core: CORE_SYNONYMS[n] ?? n, hint };
}

function tokens(s: string): Set<string> {
  return new Set(s.split(" ").filter(Boolean));
}

function jaccard(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / (ta.size + tb.size - common);
}

const wordContains = (hay: string, needle: string): boolean => ` ${hay} `.includes(` ${needle} `);

/** 1 = exacta, 0.7 = una contiene a la otra, 0.4–0.6 = tokens en común, 0 = nada. */
export function scoreName(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (wordContains(a, b) || wordContains(b, a)) return 0.7;
  const j = jaccard(a, b);
  return j >= 0.5 ? 0.4 + (j - 0.5) * 0.4 : 0;
}

const confidenceOf = (score: number): Confidence => (score >= 1 ? "alta" : score >= 0.7 ? "media" : "baja");
const DOWN: Record<Confidence, Confidence> = { alta: "media", media: "baja", baja: "baja" };

const HINT_LABELS: Record<Exclude<VariantHint, null>, readonly string[]> = {
  entera: ["entera", "grande"],
  porcion: ["porcion"],
  unidad: ["unidad"],
};

interface Candidate {
  score: number;
  confidence: Confidence;
  siteId: string;
  siteVariantId: string | null;
  siteLabel: string;
  preferred: boolean;
}

function pickVariant(
  variants: SiteCategory["products"][number]["variants"],
  hint: VariantHint,
): { id: string | null; label: string | null; penalty: boolean } {
  if (hint) {
    const wanted = HINT_LABELS[hint];
    const found = variants.find((v) => wanted.includes(normalize(v.label)) || wanted.includes(normalize(v.unit ?? "")));
    if (found) return { id: found.id, label: found.label, penalty: false };
    if (variants.length === 1) return { id: variants[0].id, label: variants[0].label, penalty: true };
    return { id: null, label: null, penalty: true };
  }
  if (variants.length === 1) return { id: variants[0].id, label: variants[0].label, penalty: false };
  return { id: null, label: null, penalty: variants.length > 1 };
}

function bestProduct(parsed: ParsedName, catalog: readonly SiteCategory[]): Candidate | null {
  let best: Candidate | null = null;
  for (const cat of catalog) {
    const preferred = cat.channel_visibility === "delivery" || cat.channel_visibility === "ambos";
    for (const p of cat.products) {
      const score = scoreName(parsed.core, normalize(p.name));
      if (score === 0) continue;
      const v = pickVariant(p.variants, parsed.hint);
      let confidence = confidenceOf(score);
      if (v.penalty) confidence = DOWN[confidence];
      const cand: Candidate = {
        score, confidence, siteId: p.id, siteVariantId: v.id, preferred,
        siteLabel: v.label ? `${p.name} · ${v.label}` : p.name,
      };
      const better =
        !best ||
        cand.score > best.score ||
        (cand.score === best.score && cand.preferred && !best.preferred);
      if (better) best = cand;
    }
  }
  return best;
}

function bestPromotion(rawName: string, promotions: readonly SitePromotion[]): Candidate | null {
  const base = normalize(rawName.replace(/\(.*$/, " "));
  let best: Candidate | null = null;
  for (const promo of promotions) {
    const score = scoreName(base, normalize(promo.name));
    if (score === 0) continue;
    if (!best || score > best.score) {
      best = { score, confidence: confidenceOf(score), siteId: promo.id, siteVariantId: null, siteLabel: promo.name, preferred: true };
    }
  }
  return best;
}

const isPromoCategory = (name: string | null | undefined): boolean => normalize(name ?? "") === "promos";

/** Sugerencias para los productos de la app que tienen un par razonable en el sitio. Los demás no aparecen. */
export function suggestLinks(
  products: readonly AppProductInput[],
  catalog: readonly SiteCategory[],
  promotions: readonly SitePromotion[],
): MatchSuggestion[] {
  const out: MatchSuggestion[] = [];
  for (const p of products) {
    const isPromo = isPromoCategory(p.categoryName);
    const cand = isPromo ? bestPromotion(p.name, promotions) : bestProduct(parseAppName(p.name), catalog);
    if (!cand) continue;
    out.push({
      appProductId: p.id,
      kind: isPromo ? "promotion" : "product",
      siteId: cand.siteId,
      siteVariantId: cand.siteVariantId,
      siteLabel: cand.siteLabel,
      confidence: cand.confidence,
    });
  }
  // Dos productos de la app apuntando al mismo destino: no se puede dar ninguno por seguro.
  const count = new Map<string, number>();
  const key = (s: MatchSuggestion) => `${s.kind}|${s.siteId}|${s.siteVariantId ?? ""}`;
  for (const s of out) count.set(key(s), (count.get(key(s)) ?? 0) + 1);
  return out.map((s) => (s.confidence === "alta" && (count.get(key(s)) ?? 0) > 1 ? { ...s, confidence: "media" } : s));
}
