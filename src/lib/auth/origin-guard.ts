/**
 * Defensa CSRF por verificación de origen para rutas de la API autenticadas por cookie.
 *
 * Complementa a `SameSite=Lax` de las cookies de Supabase (que frena los POST cross-site de los
 * navegadores modernos, pero no protege contra same-site ni contra navegadores viejos) y a que
 * `req.json()` no exige Content-Type (un <form enctype="text/plain"> puede llegar a parsearse).
 *
 * Función pura: solo mira cabeceras y método, sin dependencias de Next.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

interface HeaderReader {
  get(name: string): string | null;
}

function firstValue(raw: string | null): string | undefined {
  return raw?.split(",")[0]?.trim() || undefined;
}

/** Host efectivo de la request: el que escribió el navegador (detrás del proxy de Vercel/EasyPanel). */
function effectiveHost(headers: HeaderReader): string | null {
  const raw = firstValue(headers.get("x-forwarded-host")) ?? firstValue(headers.get("host"));
  if (!raw) return null;
  // Se normaliza con URL para que ":443"/":80" por defecto no generen falsos negativos.
  const proto = firstValue(headers.get("x-forwarded-proto")) ?? "http";
  try {
    return new URL(`${proto}://${raw}`).host.toLowerCase();
  } catch {
    return null;
  }
}

/** ¿El host (con puerto) de un Origin/Referer coincide exactamente con el host efectivo? */
function urlMatchesHost(value: string, headers: HeaderReader, host: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value); // "null" y basura lanzan acá -> no coincide
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  // Si el proxy informa el esquema, el origen tiene que usar el mismo.
  const proto = firstValue(headers.get("x-forwarded-proto"))?.toLowerCase();
  if (proto && parsed.protocol !== `${proto}:`) return false;

  // Igualdad exacta: nunca "termina en" ni "contiene" (dely.opsyn.app.evil.com).
  return parsed.host.toLowerCase() === host;
}

/**
 * ¿Puede esta request ejecutar una mutación con la sesión por cookie?
 *
 * 1. GET/HEAD/OPTIONS: siempre (no deben mutar nada).
 * 2. `Sec-Fetch-Site` (lo manda todo navegador moderno y el JS de una página no puede falsearlo):
 *    `same-origin`/`none` -> sí; `cross-site`/`same-site` -> no (same-site rechaza subdominios hermanos).
 * 3. Sin Sec-Fetch-Site: se compara el host de `Origin` (o de `Referer` si no hay Origin) con el host
 *    efectivo. `Origin: null`, esquemas raros o hosts parecidos -> no.
 * 4. Sin NINGUNA señal -> sí. Decisión: un ataque CSRF necesita un navegador, y los navegadores siempre
 *    mandan Origin en POST/PUT/PATCH/DELETE cross-origin (y Sec-Fetch-Site los modernos). Quien no manda
 *    nada es un cliente que no es navegador (curl, Workers, n8n, el APIRequestContext de Playwright en los
 *    E2E) y no hay una víctima a la que engañar: la cookie la tiene porque su dueño se la dio. Rechazarlo
 *    rompería esos clientes sin ganar protección.
 */
export function isSameOriginRequest(headers: HeaderReader, method: string): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;

  const fetchSite = headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite === "same-origin" || fetchSite === "none") return true;
  if (fetchSite === "cross-site" || fetchSite === "same-site") return false;
  // Ausente o valor desconocido: se sigue con Origin/Referer.

  const origin = headers.get("origin");
  const referer = headers.get("referer");
  if (origin === null && !referer) return true; // sin señales: cliente no-navegador

  const host = effectiveHost(headers);
  if (!host) return false;
  return urlMatchesHost((origin ?? referer ?? "").trim(), headers, host);
}
