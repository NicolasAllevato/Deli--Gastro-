/**
 * Categorías de reclamo y su clasificación por palabras clave (sin IA: determinista y testeable).
 * La usan el bot (al crear el ticket) y el panel (etiquetas). Sin dependencias de Next ni de Cloudflare.
 */
export const CATEGORIAS = ["demora", "llego_frio", "faltante", "pedido_equivocado", "cobro", "atencion", "otro"] as const;
export type Categoria = (typeof CATEGORIAS)[number];

export const CATEGORIA_LABEL: Record<Categoria, string> = {
  demora: "Demora",
  llego_frio: "Llegó frío",
  faltante: "Faltante",
  pedido_equivocado: "Pedido equivocado",
  cobro: "Cobro",
  atencion: "Atención",
  otro: "Otro",
};

const sinTildes = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Orden = prioridad: "llegó frío y tarde" es frío (lo más concreto), "me cobraron y faltó" es faltante. */
const REGLAS: ReadonlyArray<[Categoria, RegExp]> = [
  ["llego_frio", /\b(frio|fria|frios|frias|helad[oa]s?|congelad[oa])\b/],
  ["faltante", /\bfalt(a|o|aba|aron|an)\b|\bno (vino|vinieron|trajeron|mandaron|estaba|venia)\b|\bme (falta|faltan|falto)\b|\bincomplet/],
  ["pedido_equivocado", /equivoca|\botro pedido\b|\bno es (lo|el) que\b|\bno (lo )?ped[i]\b|\bvino (otra|otro|mal)\b|\bmal el pedido\b|\bcambiad[oa]\b/],
  ["cobro", /\bcobr|\bcargo\b|\bme (descontaron|debitaron)\b|\bpague de mas\b|\bvuelto\b|\bdoble (cobro|pago)\b|\breintegr|\bdevol/],
  ["demora", /\btard|\bdemor|\bno (llega|llego|llegó)\b|\bnunca llega|\btodavia no\b|\bhace (mas de )?(una|1|2|dos|\d+) (hora|horas|min)/],
  ["atencion", /\batenci|\bmal trato\b|\bmaleducad|\bgroser|\bdesubicad|\bmal(a)? onda\b|\bme (grito|trataron)\b/],
];

/** Categoría según el texto del cliente; `otro` si no se reconoce. */
export function categorizarReclamo(texto: string): Categoria {
  const t = sinTildes(texto);
  for (const [cat, re] of REGLAS) if (re.test(t)) return cat;
  return "otro";
}

const QUEJA = /\b(queja|quejar|reclamo|reclamar|horrible|malisim|desastre|verguenza|pesim|problema|inaceptable|indignad|estafa|un asco|cualquiera)\b/;

/** ¿El texto es una queja (y no solo "quiero hablar con una persona")? */
export function esQueja(texto: string): boolean {
  return categorizarReclamo(texto) !== "otro" || QUEJA.test(sinTildes(texto));
}

/** Un reclamo sin detalle concreto ("quiero hacer un reclamo"): el bot pregunta qué pasó. */
export function faltaDetalle(texto: string): boolean {
  return categorizarReclamo(texto) === "otro" && sinTildes(texto).replace(/\[[^\]]*\]/g, "").trim().length < 40;
}
