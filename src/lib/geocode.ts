import type { GeoPoint } from "./zones.ts";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const TIMEOUT_MS = 6000;
const VIEWBOX_DEG = 0.5;
const MAX_RESULTS = 5;

export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
}

interface NominatimItem {
  display_name?: unknown;
  lat?: unknown;
  lon?: unknown;
}

function parseResults(raw: unknown): GeocodeResult[] {
  if (!Array.isArray(raw)) return [];
  const results: GeocodeResult[] = [];
  for (const item of raw as NominatimItem[]) {
    const lat = Number(item.lat);
    const lng = Number(item.lon);
    if (typeof item.display_name !== "string" || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    results.push({ label: item.display_name.slice(0, 200), lat, lng });
  }
  return results;
}

/**
 * Busca una dirección con Nominatim (OpenStreetMap), sesgada hacia el entorno del local.
 * La política de uso pide 1 consulta por segundo: llamarla por acción del usuario, no al tipear.
 */
export async function geocodeAddress(
  query: string,
  near: GeoPoint,
  fetchImpl: typeof fetch = fetch,
): Promise<GeocodeResult[]> {
  const params = new URLSearchParams({
    format: "jsonv2",
    limit: String(MAX_RESULTS),
    countrycodes: "ar",
    q: query,
    viewbox: [near.lng - VIEWBOX_DEG, near.lat + VIEWBOX_DEG, near.lng + VIEWBOX_DEG, near.lat - VIEWBOX_DEG].join(","),
  });

  const res = await fetchImpl(`${NOMINATIM}?${params}`, {
    headers: { "User-Agent": "Deli-Gastro/1.0 (pedidos de delivery)", "Accept-Language": "es" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return parseResults(await res.json());
}
