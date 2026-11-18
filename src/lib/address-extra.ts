/**
 * Separa de una dirección escrita por el cliente lo que el geocoder no entiende (piso, depto, lote, timbre…)
 * de la calle y altura. Sin dependencias: lo usan la app (cotizar/guardar el pedido) y el Worker del bot (resumen).
 */
const EXTRA_RE = /\b(?:piso\s*[\w°]+|p\.?\s*\d+\w*|(?:dto|dpto|depto|departamento)\.?\s*[\w°]+|\d+\s*°\s*[a-z]?\b|lote\s*\w+|casa\s*\w+|timbre\s*\w+|torre\s*\w+|local\s*\w+|uf\s*\d+)/gi;

export interface AddressParts {
  /** Calle, altura y barrio/localidad: lo que se manda al geocoder. */
  street: string;
  /** Piso, depto, lote, timbre… tal cual los escribió el cliente ("piso 3 dto B"); vacío si no hay. */
  extra: string;
}

export function splitAddressExtra(text: string): AddressParts {
  const extras = text.match(EXTRA_RE) ?? [];
  const street = text
    .replace(EXTRA_RE, " ")
    .replace(/\s*,\s*(,\s*)+/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,]+|[\s,]+$/g, "");
  return { street: street || text.trim(), extra: extras.map((e) => e.trim().replace(/\s+/g, " ")).join(" ") };
}
