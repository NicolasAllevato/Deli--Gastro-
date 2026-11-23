/**
 * Controles puros sobre el borrador del modelo (sin base de datos ni red): cuando el texto libre afirma un horario o una zona
 * de envío que no coincide con los datos del local, el turno lo descarta (turn.ts → draftIssue) y no le llega al cliente.
 * Son heurísticas conservadoras: ante la duda (sin datos con qué comparar, frases negativas, direcciones) no marcan nada.
 */

/** Minúsculas y sin tildes. */
const fold = (text: string): string => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Frases de un texto (corta en . ! ? y saltos de línea; "23.30" no se corta porque no lleva espacio después). */
const sentences = (text: string): string[] => text.split(/(?<=[.!?])\s+|\n/);

// ---------- horarios ----------

/** Frases sobre cuándo abre o cierra el local (ya sin tildes). */
const HOURS_TOPIC = /\b(abr\w*|cierr\w*|cerr\w*|horarios?|atend\w*|atiend\w*|atencion)\b/;

/** Horarios especiales (feriados, fechas) que la configuración no puede expresar: esa frase no se controla. */
const HOURS_EXCEPTION = /\b(feriados?|navidad|fin de ano|ano nuevo|excepcion\w*)\b/;

const MINUTES_PER_DAY = 24 * 60;

/** "11:00" → 660; null si no tiene ese formato. 24:00 equivale a 00:00. */
export function minutesOfDay(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 24 || minutes > 59) return null;
  return (hours * 60 + minutes) % MINUTES_PER_DAY;
}

/** Hora 0-24 que no es parte de un número más largo (ni de los minutos de otra hora). */
const HOUR = "(?<![\\d:.])(2[0-4]|[01]?\\d)";
const asMinutes = (h: string, m?: string): number => ((Number(h) % 24) * 60 + (m ? Number(m) : 0)) % MINUTES_PER_DAY;

/** Horarios que nombra una frase (ya sin tildes): 11:00, 23.30, 11 hs, a las 20, hasta las 23, de 11 a 23. */
export function timesMentioned(sentence: string): number[] {
  const out: number[] = [];
  for (const m of sentence.matchAll(new RegExp(`${HOUR}[:.]([0-5]\\d)\\b`, "g"))) out.push(asMinutes(m[1]!, m[2]));
  for (const m of sentence.matchAll(new RegExp(`${HOUR}\\s*(?:hs?|horas?)\\b`, "g"))) out.push(asMinutes(m[1]!));
  for (const m of sentence.matchAll(new RegExp(`\\b(?:a|hasta|desde)\\s+las?\\s+${HOUR}\\b(?![:.]\\d)`, "g"))) out.push(asMinutes(m[1]!));
  for (const m of sentence.matchAll(new RegExp(`\\bde\\s+${HOUR}(?:[:.]([0-5]\\d))?\\s*(?:hs?)?\\s+a\\s+${HOUR}(?:[:.]([0-5]\\d))?`, "g"))) {
    out.push(asMinutes(m[1]!, m[2]), asMinutes(m[3]!, m[4]));
  }
  return out;
}

/**
 * true si el borrador nombra un horario de apertura o cierre que no es el de la configuración (`open`/`close` en "HH:MM").
 * Solo se miran las frases que hablan de abrir, cerrar, horario o atención; "tu pedido llega a las 21" no cuenta.
 * Sin un horario válido en la configuración no se puede comparar y no marca nada.
 */
export function hoursMismatch(draft: string, hours: { open: string; close: string }): boolean {
  const open = minutesOfDay(hours.open);
  const close = minutesOfDay(hours.close);
  if (open === null || close === null) return false;
  const valid = new Set([open, close]);
  for (const sentence of sentences(fold(draft))) {
    if (!HOURS_TOPIC.test(sentence) || HOURS_EXCEPTION.test(sentence)) continue;
    if (timesMentioned(sentence).some((t) => !valid.has(t))) return true;
  }
  return false;
}

// ---------- zonas de envío ----------

/** Verbo con la primera letra en mayúscula o minúscula (la regex no usa el flag i: el lugar tiene que ser un nombre propio). */
const verb = (word: string): string => `[${word[0]!.toUpperCase()}${word[0]}]${word.slice(1)}`;

/** Frases que prometen el envío y el lugar que sigue («enviamos a Palermo»); captura el nombre propio. */
const DELIVERY_PLACE = new RegExp(
  `(?:${["enviamos", "entregamos", "repartimos", "mandamos", "llegamos", "delivery"].map(verb).join("|")}|${verb("hacemos")}\\s+(?:el\\s+)?${verb("env")}[ií]os?|${verb("env")}[ií]o)` +
    `\\s+(?:sin\\s+problema\\s+)?(?:a|hasta|en)\\s+(?:la\\s+zona\\s+de\\s+|el\\s+barrio\\s+de\\s+|el\\s+barrio\\s+|la\\s+zona\\s+|zona\\s+)?` +
    `(\\p{Lu}[\\p{L}]+(?:\\s+(?:de\\s+|del\\s+|la\\s+|el\\s+)?\\p{Lu}[\\p{L}]+){0,2})`,
  "gu",
);

const NEGATION_BEFORE = /\b(?:no|tampoco|ni|sin)\s+(?:\w+\s+){0,2}$/;
const STREET_WORDS = new Set(["av", "avda", "avenida", "calle", "pasaje", "pje", "bv", "boulevard", "ruta", "diagonal", "diag", "camino"]);
/** Nombres de zona que no son un lugar («Zona 1», «Radio 3 km», «Zona cercana»): con ellos no hay con qué comparar un barrio. */
const GENERIC_ZONE = /^(zona|radio|area|sector|anillo|tarifa)\b|\d|\bkm\b|\b(cercan\w*|extendid\w*|lejan\w*|cerca|lejos)\b/;
const COVERAGE_SENTENCE = /\b(envio\w*|delivery|reparto|repartimos|entreg\w*|llegamos|cobertura|radio|zona)\b/;
const NEGATIVE_SENTENCE = /\b(no|tampoco|fuera|lamentablemente|desafortunadamente|sin cobertura|nunca)\b/;

const normalizeName = (name: string): string => fold(name).replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * true si el borrador promete el envío a un lugar o a una distancia que no figura en los datos del local:
 *  - un barrio con nombre propio que no es ninguna zona cargada (solo si las zonas tienen nombre de lugar: con «Zona 1» o
 *    «Radio 3 km» no hay con qué comparar un barrio);
 *  - «hasta N km» con N mayor al radio de envío configurado.
 * Sin zonas ni radio no marca nada. Las frases negativas («no llegamos a Quilmes») y las direcciones (Av. Rivadavia 5000) se ignoran.
 */
export function zoneMismatch(draft: string, data: { zones: readonly { name: string }[]; radiusKm: number | null }): boolean {
  const names = data.zones.map((z) => normalizeName(z.name)).filter(Boolean);
  if (names.some((n) => !GENERIC_ZONE.test(n)) && promisesUnknownPlace(draft, names)) return true;
  return data.radiusKm !== null && data.radiusKm > 0 && promisesFartherThan(draft, data.radiusKm);
}

function promisesUnknownPlace(draft: string, zoneNames: readonly string[]): boolean {
  for (const m of draft.matchAll(DELIVERY_PLACE)) {
    const place = m[1]!;
    const index = m.index ?? 0;
    if (NEGATION_BEFORE.test(fold(draft.slice(Math.max(0, index - 24), index)))) continue;
    // Una dirección («Rivadavia 5000», «Av. Corrientes») no es una zona: no se compara.
    if (/^\s*\d/.test(draft.slice(index + m[0].length, index + m[0].length + 8))) continue;
    const key = normalizeName(place);
    if (!key || /\d/.test(key) || STREET_WORDS.has(key.split(" ")[0]!)) continue;
    if (!zoneNames.some((z) => z.includes(key) || key.includes(z))) return true;
  }
  return false;
}

function promisesFartherThan(draft: string, radiusKm: number): boolean {
  for (const sentence of sentences(fold(draft))) {
    if (!COVERAGE_SENTENCE.test(sentence) || NEGATIVE_SENTENCE.test(sentence)) continue;
    for (const m of sentence.matchAll(/\b(\d+(?:[.,]\d+)?)\s*km\b/g)) {
      if (Number(m[1]!.replace(",", ".")) > radiusKm) return true;
    }
  }
  return false;
}

// ---------- productos que existen ----------

/** «No tenemos / no hay / no trabajamos …» y lo que sigue hasta una coma, punto o «pero». */
const NEGATED_OFFER = /\bno\s+(?:tenemos|tengo|hay|trabajamos|hacemos|vendemos|manejamos|contamos con|preparamos|elaboramos)\s+([^,.;:!?\n()]+)/g;
const OFFER_TAIL = /\s(?:pero|aunque|sino|por ahora|por el momento|hoy|ahora)\b.*$/;
/** Palabras que no identifican un producto (artículos, relleno y términos genéricos del menú). */
const NOT_A_PRODUCT_WORD = new Set([
  "de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas", "algo", "mas", "nada", "para", "por", "con", "sin", "ese", "esa", "eso",
  "ningun", "ninguna", "disponible", "disponibles", "stock", "opcion", "opciones", "producto", "productos", "promo", "promos", "combo", "combos", "menu",
]);

const wordsOf = (text: string): string[] => fold(text).split(/[^a-z0-9ñ]+/).filter(Boolean);
const stemOf = (word: string): string => (word.length > 3 ? word.replace(/(?:es|s)$/, "") : word);
/** La palabra del menú es la misma del cliente, en singular o plural. */
const sameWord = (menuWord: string, stem: string): boolean => menuWord === stem || menuWord === `${stem}s` || menuWord === `${stem}es`;

/**
 * Si el borrador afirma «no tenemos X» y X es un producto ACTIVO del menú (todas las palabras de X están en su nombre,
 * en singular o plural), devuelve el nombre del producto; si no, null. «No tenemos empanadas de humita» contradice
 * «Empanada Humita». Las frases genéricas («no hay promos») y lo que no está en el menú («no tenemos pastas») no marcan nada.
 */
export function deniesExistingProduct(draft: string, menu: readonly { name: string }[]): string | null {
  const products = menu.map((p) => ({ name: p.name, words: wordsOf(p.name) }));
  for (const m of fold(draft).matchAll(NEGATED_OFFER)) {
    const stems = wordsOf((m[1] ?? "").replace(OFFER_TAIL, "")).filter((w) => w.length >= 3 && !NOT_A_PRODUCT_WORD.has(w)).map(stemOf);
    if (stems.length === 0) continue;
    const hit = products.find((p) => stems.every((s) => p.words.some((w) => sameWord(w, s))));
    if (hit) return hit.name;
  }
  return null;
}
