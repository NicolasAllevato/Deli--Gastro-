/**
 * Control puro de una cotización contra lo que el cliente escribió en ESTE mensaje (sin red ni base).
 * El modelo (gpt-4o-mini) a veces elige el id de un producto parecido («Agua con gas» por «sin gas», «Porción Fugazzeta» por
 * «una grande de jamón y morrón») o repite una cantidad (12 de carne cuando pidió 6). Si algo no cuadra, `quote_order` no cotiza
 * y le devuelve al modelo qué corregir. Heurístico y conservador: ante la duda (texto ambiguo, docenas, sin menú) no marca nada.
 */

interface MenuName { id: string; name: string }
interface QuoteLine { product_id: string; qty: number }

const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Pares de variantes que el cliente distingue con una palabra: si nombra solo una, la línea no puede ser de la otra. */
const VARIANTS: ReadonlyArray<{ a: { label: string; re: RegExp }; b: { label: string; re: RegExp } }> = [
  { a: { label: "con gas", re: /\bcon gas\b/ }, b: { label: "sin gas", re: /\bsin gas\b/ } },
  { a: { label: "grande", re: /\bgrandes?\b/ }, b: { label: "porción", re: /\bporcion(?:es)?\b/ } },
];

const WORD_NUMBERS: Readonly<Record<string, number>> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 };
/** Palabras que comparten muchos productos: no identifican de cuál habla el cliente. */
const GENERIC = new Set(["empanada", "empanadas", "porcion", "porciones", "grande", "grandes", "pizza", "pizzas", "docena", "docenas", "gaseosa", "bebida"]);
const WINDOW = 4;
/** Palabras de relleno que a veces empiezan igual que un producto del menú. */
const FILLER = new Set(["para", "pedido", "mejor", "quiero", "dame", "delivery", "entre", "tambien", "ademas"]);

const words = (s: string): string[] => fold(s).split(/[^a-z0-9ñ]+/).filter(Boolean);
const numberOf = (w: string): number | null => (/^\d{1,3}$/.test(w) ? Number(w) : (WORD_NUMBERS[w] ?? null));
/** Palabras que identifican al producto (4+ letras, sin las genéricas), por su prefijo de 4 letras. */
const keyPrefixes = (name: string): Set<string> => new Set(words(name).filter((w) => w.length >= 4 && !GENERIC.has(w)).map((w) => w.slice(0, 4)));

/** Productos del menú con la variante pedida (`want`) que además comparten una palabra con el texto del cliente. */
function candidates(menu: readonly MenuName[], want: RegExp, textWords: ReadonlySet<string>): MenuName[] {
  return menu
    .filter((m) => want.test(fold(m.name)))
    .filter((m) => [...keyPrefixes(m.name)].some((p) => textWords.has(p)))
    .slice(0, 5);
}

function variantError(text: string, lines: readonly QuoteLine[], menu: readonly MenuName[], byId: ReadonlyMap<string, string>): string | null {
  const t = fold(text);
  const textPrefixes = new Set(words(text).filter((w) => w.length >= 4).map((w) => w.slice(0, 4)));
  for (const { a, b } of VARIANTS) {
    const hasA = a.re.test(t);
    const hasB = b.re.test(t);
    if (hasA === hasB) continue;
    const [wanted, other] = hasA ? [a, b] : [b, a];
    for (const l of lines) {
      const name = byId.get(l.product_id);
      if (!name) continue;
      const f = fold(name);
      if (!other.re.test(f) || wanted.re.test(f)) continue;
      const options = candidates(menu, wanted.re, textPrefixes).map((m) => `«${m.name}» (product_id ${m.id})`);
      return (
        `El cliente pidió «${wanted.label}» pero elegiste «${name}», que es «${other.label}». Corregí la línea con el producto que corresponde` +
        (options.length > 0 ? `: ${options.join(", ")}.` : `: buscalo por nombre en get_menu o get_categoria (la carta agrupa variantes bajo un solo nombre).`) +
        " No se lo menciones al cliente."
      );
    }
  }
  return null;
}

/** Cantidades que el cliente escribió pegadas a un producto: [número, palabras clave (prefijos) que lo siguen]. */
function numbersWithWords(text: string): Array<{ n: number; next: string[] }> {
  const tokens = words(text);
  const out: Array<{ n: number; next: string[] }> = [];
  tokens.forEach((tok, i) => {
    const n = numberOf(tok);
    if (n === null) return;
    const next: string[] = [];
    for (const w of tokens.slice(i + 1, i + 1 + WINDOW)) {
      if (numberOf(w) !== null) break;
      if (w.length >= 4 && !FILLER.has(w)) next.push(w.slice(0, 4));
    }
    out.push({ n, next });
  });
  return out;
}

function quantityError(text: string, lines: readonly QuoteLine[], menu: readonly MenuName[], byId: ReadonlyMap<string, string>): string | null {
  const t = fold(text);
  // Docenas y medias docenas las arma el sistema con otras cuentas: no se controlan.
  if (/\b(docenas?|media|medio)\b/.test(t)) return null;
  const keys = new Map<string, Set<string>>();
  for (const l of lines) if (!keys.has(l.product_id)) keys.set(l.product_id, keyPrefixes(byId.get(l.product_id) ?? ""));
  for (const { n, next } of numbersWithWords(text)) {
    const hit = lines.filter((l) => [...(keys.get(l.product_id) ?? [])].some((p) => next.includes(p)));
    if (hit.length === 0) {
      // El cliente nombra un producto del menú con su cantidad y ninguna línea lo contiene: el modelo eligió otro producto (o lo omitió).
      const named = menu.filter((m) => [...keyPrefixes(m.name)].some((p) => next.includes(p))).slice(0, 4);
      if (named.length > 0) {
        const options = named.map((m) => `«${m.name}» (product_id ${m.id})`).join(", ");
        return `El cliente pidió ${n} de algo que coincide con ${options}, y ninguna línea de la cotización es de ese producto. Corregí la cotización con el producto que pidió (y su cantidad). No se lo menciones al cliente.`;
      }
      continue;
    }
    const sum = hit.reduce((acc, l) => acc + l.qty, 0);
    if (sum === n || hit.some((l) => l.qty === n)) continue;
    const names = [...new Set(hit.map((l) => byId.get(l.product_id) ?? ""))].map((x) => `«${x}»`).join(", ");
    return `El cliente pidió ${n} de lo que coincide con ${names} pero la cotización lleva ${sum}. Corregí las cantidades: no sumes ni repitas unidades (si dudás, repreguntá). No se lo menciones al cliente.`;
  }
  return null;
}

/** Mensaje de error para el modelo si la cotización contradice el texto del cliente; null si cuadra o no se puede saber. */
export function checkQuoteAgainstText(text: string, lines: readonly QuoteLine[], menu: readonly MenuName[]): string | null {
  if (!text.trim() || menu.length === 0) return null;
  const byId = new Map(menu.map((m) => [m.id, m.name] as const));
  return variantError(text, lines, menu, byId) ?? quantityError(text, lines, menu, byId);
}
