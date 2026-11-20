/**
 * Preguntas frecuentes desde un archivo (.txt, .md o .csv) para la base de conocimiento del agente. Parser puro: no toca la base
 * ni confía en el contenido (todo se recorta, se limpia de caracteres de control y se valida contra los topes de `kb_negocio`).
 *
 * Formatos:
 *  - texto: bloques «P: pregunta / R: respuesta» (también «Pregunta:» / «Respuesta:») separados por una línea en blanco; opcional
 *    una línea «Claves: horario, abren, hora»; las líneas que empiezan con «# » son comentarios;
 *  - markdown: «## pregunta» seguido de uno o más párrafos de respuesta (y, si se quiere, «Claves: ...»);
 *  - csv: primera fila con las columnas pregunta, respuesta y, opcional, palabras_clave (acepta «,» y «;»).
 */
import { parseCsv } from "../catalog/sheet.ts";

/** Tope de preguntas por archivo (ya partidas las respuestas largas) y de tamaño del archivo. */
export const MAX_FAQ_ITEMS = 200;
export const MAX_FAQ_FILE_BYTES = 200 * 1024;
export const FAQ_EXTENSIONS = [".txt", ".md", ".csv"] as const;

/** Topes de las columnas de kb_negocio. */
export const FAQ_TEMA_MAX = 120;
export const FAQ_CONTENIDO_MAX = 1000;
export const FAQ_CLAVES_MAX = 300;
/** Una respuesta más larga que esto no se parte: se rechaza (son hasta 5 entradas de 1000 caracteres). */
const MAX_PARTS = 5;

export interface FaqItem {
  tema: string;
  contenido: string;
  palabras_clave: string;
  /** Línea (texto) o fila (csv) donde empieza en el archivo, para los mensajes de error. */
  line: number;
}

export interface FaqIssue {
  line: number;
  message: string;
}

export interface FaqParseResult {
  items: FaqItem[];
  /** Lo que no se pudo leer: esas preguntas no entran. */
  errores: FaqIssue[];
  /** Ajustes que se hicieron para que entre (tema recortado, respuesta partida, claves recortadas). */
  avisos: FaqIssue[];
}

export type FaqFileKind = "text" | "csv";

/** Tipo de archivo según la extensión; null si no es .txt, .md ni .csv. */
export function faqFileKind(filename: string): FaqFileKind | null {
  const ext = /\.[a-z0-9]+$/i.exec(filename.trim())?.[0].toLowerCase();
  if (ext === ".csv") return "csv";
  if (ext === ".txt" || ext === ".md") return "text";
  return null;
}

/** Valida nombre y tamaño (en bytes) antes de leer el contenido. Devuelve el motivo del rechazo o null si está bien. */
export function checkFaqFile(filename: string, bytes: number): string | null {
  if (faqFileKind(filename) === null) return `El archivo tiene que ser ${FAQ_EXTENSIONS.join(", ")}.`;
  if (!Number.isFinite(bytes) || bytes <= 0) return "El archivo está vacío.";
  if (bytes > MAX_FAQ_FILE_BYTES) return `El archivo pesa más de ${MAX_FAQ_FILE_BYTES / 1024} KB.`;
  return null;
}

// ---------- limpieza ----------

/** Sin caracteres de control (salvo salto de línea y tabulación) ni marcas de dirección invisibles. */
const clean = (text: string): string =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, "");

/** Una sola línea, sin espacios repetidos. */
const flat = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Párrafos con saltos de línea (máx. una línea en blanco seguida), sin espacios al final de cada línea. */
const paragraphs = (lines: readonly string[]): string =>
  lines
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Corte de `text` en `max` caracteres con «…» si no entra. */
function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…` : text;
}

/** Normaliza las claves ("a ,b;; c" → "a, b, c") y las recorta en el último separador que entre. */
function cleanKeywords(raw: string): { value: string; clipped: boolean } {
  const parts = flat(raw)
    .split(/[,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  let value = "";
  for (const part of parts) {
    const next = value ? `${value}, ${part}` : part;
    if (next.length > FAQ_CLAVES_MAX) return { value, clipped: true };
    value = next;
  }
  return { value, clipped: false };
}

/** Parte `text` en trozos de hasta `max` caracteres, cortando en salto de línea, fin de oración o espacio (en ese orden de preferencia). */
export function splitAnswer(text: string, max: number = FAQ_CONTENIDO_MAX): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const sentence = Math.max(...[...window.matchAll(/[.!?…](?=\s)/g)].map((m) => (m.index ?? 0) + 1), -1);
    const candidates = [window.lastIndexOf("\n"), sentence, window.lastIndexOf(" ")];
    // Un corte demasiado al principio deja un trozo diminuto: se prefiere el primer candidato en la segunda mitad de la ventana.
    const cut = candidates.find((c) => c >= max / 2) ?? max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

// ---------- una pregunta ya leída -> entradas de la base ----------

/**
 * Valida y ajusta una pregunta con su respuesta. Devuelve 0 entradas si falta algo (con el error), 1 normalmente y varias
 * si la respuesta no entra en 1000 caracteres («tema (1/2)», «tema (2/2)»).
 */
function toItems(rawTema: string, rawAnswer: string, rawKeywords: string, line: number, out: FaqParseResult): FaqItem[] {
  const tema = flat(rawTema);
  const answer = rawAnswer.trim();
  if (!tema) {
    out.errores.push({ line, message: "Falta la pregunta." });
    return [];
  }
  if (!answer) {
    out.errores.push({ line, message: `La pregunta «${clip(tema, 40)}» no tiene respuesta.` });
    return [];
  }
  const keywords = cleanKeywords(rawKeywords);
  if (keywords.clipped) out.avisos.push({ line, message: `Las palabras clave de «${clip(tema, 40)}» pasan de ${FAQ_CLAVES_MAX} caracteres: se recortaron.` });

  const parts = splitAnswer(answer);
  if (parts.length > MAX_PARTS) {
    out.errores.push({ line, message: `La respuesta de «${clip(tema, 40)}» es demasiado larga (máx. ${MAX_PARTS * FAQ_CONTENIDO_MAX} caracteres).` });
    return [];
  }
  if (parts.length > 1) out.avisos.push({ line, message: `La respuesta de «${clip(tema, 40)}» pasa de ${FAQ_CONTENIDO_MAX} caracteres: se partió en ${parts.length} entradas.` });

  return parts.map((contenido, i) => {
    const suffix = parts.length > 1 ? ` (${i + 1}/${parts.length})` : "";
    const base = clip(tema, FAQ_TEMA_MAX - suffix.length);
    if (i === 0 && base !== tema) out.avisos.push({ line, message: `La pregunta «${clip(tema, 40)}» pasa de ${FAQ_TEMA_MAX} caracteres: se recortó.` });
    return { tema: `${base}${suffix}`, contenido, palabras_clave: keywords.value, line };
  });
}

// ---------- texto / markdown ----------

const QUESTION = /^\s*(?:P|Pregunta)\s*[:：]\s*(.*)$/i;
const ANSWER = /^\s*(?:R|Respuesta)\s*[:：]\s*(.*)$/i;
const KEYWORDS = /^\s*(?:Claves|Palabras\s+clave|Keywords?)\s*[:：]\s*(.*)$/i;
const HEADING = /^\s{0,3}#{2,6}\s+(.+?)\s*#*\s*$/;
/** «# algo» (una sola almohadilla): comentario o título del documento. «##» ya es una pregunta. */
const COMMENT = /^\s*#(?!#)/;

interface Draft {
  tema: string[];
  answer: string[];
  keywords: string[];
  line: number;
  field: "tema" | "answer" | "keywords";
  /** true = vino de un «## título»: las líneas en blanco son parte de la respuesta y termina en el próximo título. */
  markdown: boolean;
}

function parseFaqText(raw: string): FaqParseResult {
  const out: FaqParseResult = { items: [], errores: [], avisos: [] };
  let draft: Draft | null = null;

  const flush = () => {
    if (draft) out.items.push(...toItems(draft.tema.join(" "), paragraphs(draft.answer), draft.keywords.join(", "), draft.line, out));
    draft = null;
  };

  clean(raw)
    .split("\n")
    .forEach((text, index) => {
      const line = index + 1;
      if (COMMENT.test(text)) return;
      if (!text.trim()) {
        if (draft?.markdown && draft.field === "answer") draft.answer.push("");
        else flush();
        return;
      }
      const heading = HEADING.exec(text);
      const question = heading ? null : QUESTION.exec(text);
      if (heading || question) {
        flush();
        draft = { tema: [(heading ?? question)![1]!], answer: [], keywords: [], line, field: heading ? "answer" : "tema", markdown: Boolean(heading) };
        return;
      }
      const answer = ANSWER.exec(text);
      const keywords = KEYWORDS.exec(text);
      if (!draft) {
        out.errores.push({ line, message: answer || keywords ? "Esta línea no tiene una pregunta antes (P: ...)." : "Esta línea está fuera de una pregunta: se ignora." });
        return;
      }
      const current: Draft = draft;
      if (answer) {
        current.field = "answer";
        current.answer.push(answer[1]!);
      } else if (keywords) {
        current.field = "keywords";
        current.keywords.push(keywords[1]!);
      } else {
        current[current.field].push(text);
      }
    });
  flush();

  if (out.items.length === 0 && out.errores.length === 0) {
    out.errores.push({ line: 1, message: "No encontré preguntas. Usá bloques «P: ... / R: ...» separados por una línea en blanco, o «## pregunta» con su respuesta debajo." });
  }
  return out;
}

// ---------- csv ----------

const normalizeHeader = (h: string): string => flat(h).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[\s_-]+/g, "");

const COLUMNS: Record<"question" | "answer" | "keywords", readonly string[]> = {
  question: ["pregunta", "tema", "p"],
  answer: ["respuesta", "contenido", "r"],
  keywords: ["palabrasclave", "claves", "keywords", "palabras"],
};

function parseFaqCsv(raw: string): FaqParseResult {
  const out: FaqParseResult = { items: [], errores: [], avisos: [] };
  const rows = parseCsv(clean(raw)).filter((r) => r.some((c) => c.trim() !== ""));
  const header = (rows[0] ?? []).map(normalizeHeader);
  const column = (names: readonly string[]) => header.findIndex((h) => names.includes(h));
  const [q, a, k] = [column(COLUMNS.question), column(COLUMNS.answer), column(COLUMNS.keywords)];
  if (q < 0 || a < 0) {
    out.errores.push({ line: 1, message: "La primera fila tiene que tener las columnas «pregunta» y «respuesta» (y, si querés, «palabras_clave»)." });
    return out;
  }
  rows.slice(1).forEach((row, i) => {
    const line = i + 2;
    out.items.push(...toItems(row[q] ?? "", paragraphs((row[a] ?? "").split("\n")), k >= 0 ? (row[k] ?? "") : "", line, out));
  });
  if (rows.length < 2) out.errores.push({ line: 1, message: "El archivo no tiene filas con preguntas." });
  return out;
}

// ---------- entrada pública ----------

/** Aplica el tope por archivo: las preguntas que sobran se descartan con un solo aviso en errores. */
function capItems(result: FaqParseResult): FaqParseResult {
  if (result.items.length <= MAX_FAQ_ITEMS) return result;
  const first = result.items[MAX_FAQ_ITEMS]!;
  return {
    ...result,
    items: result.items.slice(0, MAX_FAQ_ITEMS),
    errores: [...result.errores, { line: first.line, message: `El archivo supera el tope de ${MAX_FAQ_ITEMS} preguntas: se ignoran las que siguen.` }],
  };
}

/**
 * Lee un archivo de preguntas frecuentes. `filename` decide el formato (.csv o .txt/.md); `content` es el texto ya decodificado.
 * No lanza: un archivo inválido devuelve `errores` y ningún ítem.
 */
export function parseFaqFile(filename: string, content: string): FaqParseResult {
  const kind = faqFileKind(filename);
  if (kind === null) return { items: [], errores: [{ line: 1, message: `El archivo tiene que ser ${FAQ_EXTENSIONS.join(", ")}.` }], avisos: [] };
  return capItems(kind === "csv" ? parseFaqCsv(content) : parseFaqText(content));
}

/** Clave para detectar duplicados: sin tildes, mayúsculas ni signos («¿Cómo pago?» = «como pago»). */
export function faqKey(tema: string): string {
  return tema
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
