import { haversineKm } from "./restaurant.ts";
import type { GeocodeResult } from "./geocode.ts";
import type { GeoPoint } from "./zones.ts";

/** Reglas para aceptar una coordenada automática. Sin I/O. Ante la duda no se ubica: un punto falso engaña más que un «sin ubicación». */

/** Con esta cantidad de intentos la dirección ya no se vuelve a consultar (columna `orders.geocode_attempts`). */
export const GEOCODE_MAX_ATTEMPTS = 3;
/** Más lejos del local que esto no puede ser una entrega propia: es la misma calle en otra localidad. */
export const GEOCODE_MAX_KM = 15;
/** Si dos resultados cercanos están más separados que esto, la dirección es ambigua. */
export const GEOCODE_MAX_SPREAD_KM = 0.4;

const EXTRA_SEGMENT = /\b(piso|pb|depto|dpto|departamento|timbre|torre|lote|manzana|mz|entre|esq|esquina)\b/i;
const ONLY_UNIT = /^(\d{1,2}\s*[a-z]?|[a-z])$/i;
const INLINE_EXTRA = /\s+(piso|pb|depto|dpto|departamento|timbre|torre)\b.*$/i;
const HOUSE_NUMBER = /\b(\d{1,5})\b/;
const HOUSE_NUMBERS = /\b\d{1,5}\b/g;

/** Calle y número (más la localidad si viene), sin piso ni depto, que hacen fallar la búsqueda. `null` si no hay altura. */
export function prepareGeocodeQuery(address: string | null | undefined): string | null {
  if (!address) return null;
  const [head = "", ...rest] = address.split(",").map((s) => s.trim());
  const street = head.replace(INLINE_EXTRA, "").trim();
  if (!HOUSE_NUMBER.test(street) || !/[a-záéíóúñ]{2}/i.test(street)) return null;
  const tail = rest.filter((s) => s && !EXTRA_SEGMENT.test(s) && !ONLY_UNIT.test(s));
  return [street, ...tail].join(", ").slice(0, 200);
}

/** El resultado que se puede usar, o `null` si no hay uno cercano, inequívoco y con la altura pedida. */
export function chooseGeocodeMatch(query: string, results: readonly GeocodeResult[], near: GeoPoint): GeocodeResult | null {
  const close = results.filter((r) => haversineKm(r, near) <= GEOCODE_MAX_KM);
  const first = close[0];
  if (!first) return null;
  if (close.some((r) => haversineKm(r, first) > GEOCODE_MAX_SPREAD_KM)) return null;
  // Sin la altura en el resultado, Nominatim devolvió la calle entera: el punto sería el medio de la calle.
  // La altura es el último número de la calle: en «25 de Mayo 1234» es 1234, no 25.
  const number = (query.split(",")[0] ?? "").match(HOUSE_NUMBERS)?.at(-1);
  // Nominatim la devuelve como segmento propio al principio («1841, Piedras, …»); un número dentro del nombre no cuenta.
  const segments = first.label.split(",").slice(0, 2).map((s) => s.trim());
  return number && segments.includes(number) ? first : null;
}

export type GeocodeOutcome =
  | { kind: "located"; patch: { delivery_lat: number; delivery_lng: number; geocode_attempts: number } }
  | { kind: "rejected"; patch: { geocode_attempts: number } }
  | { kind: "error"; patch: { geocode_attempts: number } };

export interface GeocodeTarget {
  delivery_address: string | null;
  geocode_attempts: number;
}

type Search = (query: string, near: GeoPoint) => Promise<GeocodeResult[]>;

/** Resuelve un pedido. No lanza: un error de red cuenta un intento; lo que no se puede ubicar cierra de una vez. */
export async function geocodeOutcome(order: GeocodeTarget, near: GeoPoint, search: Search): Promise<GeocodeOutcome> {
  const query = prepareGeocodeQuery(order.delivery_address);
  if (!query) return { kind: "rejected", patch: { geocode_attempts: GEOCODE_MAX_ATTEMPTS } };
  try {
    const match = chooseGeocodeMatch(query, await search(query, near), near);
    return match
      ? { kind: "located", patch: { delivery_lat: match.lat, delivery_lng: match.lng, geocode_attempts: order.geocode_attempts + 1 } }
      : { kind: "rejected", patch: { geocode_attempts: GEOCODE_MAX_ATTEMPTS } };
  } catch {
    return { kind: "error", patch: { geocode_attempts: order.geocode_attempts + 1 } };
  }
}
