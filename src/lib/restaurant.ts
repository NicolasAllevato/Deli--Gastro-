/** Ubicación del local (Buenos Aires) usada para calcular distancia y costo de envío. */
export const RESTAURANT_LOCATION = { lat: -34.6, lng: -58.39, name: "Deli-Gastro" } as const;

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Costo de envío: tarifa base + costo por km (config `costo_por_km`). */
export function calcDeliveryFee(distanceKm: number, costoPorKm: number): number {
  return Math.round((500 + distanceKm * costoPorKm) / 10) * 10;
}

export interface SavedAddress {
  label: string;
  address: string;
  lat: number;
  lng: number;
}

/** Direcciones de ejemplo (demo) con coordenadas conocidas. */
export const SAMPLE_ADDRESSES: readonly SavedAddress[] = [
  { label: "Casa",      address: "Av. Corrientes 1234, CABA",   lat: -34.6037, lng: -58.3816 },
  { label: "Trabajo",   address: "Thames 856, Palermo",         lat: -34.5886, lng: -58.43 },
  { label: "Santa Fe",  address: "Av. Santa Fe 3400, Recoleta", lat: -34.587,  lng: -58.41 },
  { label: "San Telmo", address: "Defensa 800, San Telmo",      lat: -34.618,  lng: -58.372 },
  { label: "Belgrano",  address: "Av. Cabildo 2100, Belgrano",  lat: -34.56,   lng: -58.456 },
] as const;
