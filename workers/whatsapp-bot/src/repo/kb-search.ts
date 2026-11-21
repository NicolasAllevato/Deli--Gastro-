/**
 * Búsqueda en la base de conocimiento (kb_negocio) a partir de lo que pregunta el cliente. Puro, sin base de datos:
 * arma la consulta FTS5 (tokeniza, saca palabras vacías del español, aplica un stem liviano y escapa todo) y los
 * patrones LIKE del respaldo. El SQL y los valores van siempre por bind() (repo/d1.ts); nada de esto se concatena a SQL.
 */

/** Tope de entradas que devuelve la búsqueda (lo que ve el modelo en un solo get_business_info). */
export const SEARCH_LIMIT = 8;
/** Sin consulta (o solo palabras vacías): cuántas entradas se devuelven. */
export const NO_QUERY_LIMIT = 5;
/** Máximo de términos que entran a la consulta (el cliente escribe poco; esto acota el costo). */
export const MAX_TERMS = 8;
/** Máximo de términos del respaldo LIKE (cada uno son 2 comparaciones). */
export const MAX_LIKE_TERMS = 5;

const MAX_QUERY_CHARS = 300;

/** Palabras sin carga de significado (sin tildes, en minúscula) que no sirven para buscar. */
const STOPWORDS = new Set(
  (
    "a al algo algun alguna algunas alguno algunos ante antes aqui asi aun buen buena buenas bueno buenos cada como con contra cual cuales cuando cuanto cuantos cuanta cuantas " +
    "da dale de del desde donde dos el ella ellas ellos en entre era eran es esa esas ese eso esos esta estan estar este esto estos favor fue ha han hasta hay hola " +
    "la las le les lo los mas me mi mis muy ni no nos o os para pero poco por porfa porque pregunta puede pueden puedo que quiero quisiera quiere queria quien " +
    "se ser si sin sobre son soy su sus tambien tan te tal tenemos tengo tiene tienen tienes toda todas todo todos tu tus un una unas uno unos usted ustedes va van vos y ya yo " +
    "gracias disculpa disculpen perdon saber decime decir dime avisame necesito consulta"
  ).split(" "),
);

/** Minúsculas y sin tildes (la ñ pasa a n: el índice usa unicode61 con remove_diacritics 2, que hace lo mismo). */
export function foldText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Raíz liviana para que "cancelo", "cancelar" y "cancelación" encuentren lo mismo con prefijo (`cancel*`):
 * saca la s del plural, la terminación de infinitivo o la vocal final. No es un stemmer completo: lo que no cubre
 * lo cubren las palabras clave de la entrada.
 */
export function stem(term: string): string {
  let s = term;
  if (s.length >= 5 && s.endsWith("s")) s = s.slice(0, -1);
  if (s.length >= 7 && /(ar|er|ir)$/.test(s)) return s.slice(0, -2);
  if (s.length >= 6 && /[aeio]$/.test(s)) return s.slice(0, -1);
  return s;
}

/** Términos de búsqueda del texto del cliente: sin palabras vacías, sin repetidos, con stem, máx. MAX_TERMS. */
export function searchTerms(text: string): string[] {
  const out: string[] = [];
  for (const raw of foldText(text.slice(0, MAX_QUERY_CHARS)).split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    const term = stem(raw);
    if (!out.includes(term)) out.push(term);
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}

/** Frase entre comillas de FTS5: las comillas internas se duplican (los términos ya son solo letras y números). */
const quote = (term: string): string => `"${term.replace(/"/g, '""')}"`;

/**
 * Consulta FTS5 segura: cada término entre comillas (nunca se interpreta como operador, columna ni NEAR) y con prefijo
 * (`"cancel"*`), unidos por OR; el ranking bm25 pone primero a las entradas que cubren más términos. Los de 2 letras
 * van exactos (un prefijo de 2 letras trae casi todo). Devuelve null si no queda ningún término.
 */
export function buildFtsQuery(text: string): string | null {
  const terms = searchTerms(text);
  if (terms.length === 0) return null;
  return terms.map((t) => (t.length >= 3 ? `${quote(t)}*` : quote(t))).join(" OR ");
}

/** Escapa %, _ y \ para un LIKE ... ESCAPE '\'. */
export const escapeLike = (term: string): string => term.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Patrones `%término%` (ya escapados) del respaldo LIKE; vacío si no hay términos. */
export function likePatterns(text: string): string[] {
  return searchTerms(text)
    .slice(0, MAX_LIKE_TERMS)
    .map((t) => `%${escapeLike(t)}%`);
}
