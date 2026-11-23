/**
 * Dirección corta para mostrarle al cliente («¿Te lo enviamos a …?»). El geocoder guarda en los pedidos algo como
 * «Army, 5000, Avenida Rivadavia, Caballito, Buenos Aires, Comuna 6, …, Argentina — piso 3 dto B»: nombre del lugar,
 * altura, calle, barrio, ciudad, país. Se deja calle y altura (y el piso/dto que el cliente agregó).
 */
const MAX_LENGTH = 100;
const HOUSE_NUMBER = /^\d{1,5}[a-z]?$/i;

export function shortAddress(raw: string): string {
  const [main = "", ...extra] = raw.replace(/\s+/g, " ").trim().split(/\s+[—–]\s+/);
  const parts = main.split(",").map((p) => p.trim()).filter(Boolean);
  let street = parts.join(", ");
  if (parts.length > 2) {
    const at = parts.findIndex((p) => HOUSE_NUMBER.test(p));
    // «lugar, 5000, Avenida Rivadavia, …»: la altura va suelta y la calle es la parte que sigue.
    street = at >= 0 && parts[at + 1] ? `${parts[at + 1]} ${parts[at]}` : parts.slice(0, 2).join(", ");
  }
  return [street, extra.join(" — ").trim()].filter(Boolean).join(", ").slice(0, MAX_LENGTH);
}
