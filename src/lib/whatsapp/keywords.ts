export type Keyword = "opt_in" | "opt_out";

const OPT_OUT = /^(baja|stop|dar de baja|no quiero mas (promos|promociones|mensajes))$/;
const OPT_IN = /^(alta|quiero (recibir )?(promos|promociones))$/;

/** Minúsculas, sin tildes ni signos: "¡Baja!" → "baja". */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detecta el alta o la baja de promociones. Solo coincide si el mensaje ENTERO es la
 * palabra clave, para no confundir "dame de baja el volumen" con una baja.
 */
export function detectKeyword(text: string): Keyword | null {
  const clean = normalize(text);
  if (OPT_OUT.test(clean)) return "opt_out";
  if (OPT_IN.test(clean)) return "opt_in";
  return null;
}
