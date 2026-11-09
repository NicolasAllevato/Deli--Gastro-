// Completa la ubicación de los pedidos de delivery viejos de Fudo: copia la dirección de `clients.address`
// y geocodifica con Nominatim a 1 pedido por segundo. Requiere la migración 027.
//
//   node --env-file=.env.local scripts/geocodificar-historico.mjs                 -> dry-run: solo cuenta, no escribe ni llama a Nominatim
//   node --env-file=.env.local scripts/geocodificar-historico.mjs --aplicar       -> escribe en la base que indique el entorno
//   ... --aplicar --limite=20                                                     -> prueba con pocos pedidos
//
// No imprime direcciones ni nombres, solo cantidades.

import { runGeocodeBackfill } from "../src/lib/geocode-backfill.ts";
import { GEOCODE_MAX_ATTEMPTS } from "../src/lib/geocode-match.ts";
import { geocodeAddress } from "../src/lib/geocode.ts";
import { RESTAURANT_LOCATION } from "../src/lib/restaurant.ts";

const PAGE = 1000;
const ID_BATCH = 100;

function parseArgs(argv) {
  const limitArg = argv.find((a) => a.startsWith("--limite="));
  const limit = limitArg ? Number(limitArg.slice("--limite=".length)) : null;
  if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) throw new Error("--limite tiene que ser un entero positivo.");
  return { apply: argv.includes("--aplicar"), limit };
}

function createRest(url, key) {
  return async (path, init = {}) => {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", prefer: "return=minimal", ...init.headers },
    });
    if (!res.ok) throw new Error(`Supabase ${path.split("?")[0]} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  };
}

async function loadOrders(rest) {
  const select = "id,client_id,delivery_address,fudo_source,geocode_attempts";
  const filter = "channel=eq.fudo&fudo_sale_type=eq.DELIVERY&status=eq.Finalizados&delivery_lat=is.null&delivered_lat=is.null";
  const all = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await rest(`orders?${filter}&select=${select}&order=id.asc&limit=${PAGE}&offset=${offset}`);
    all.push(...rows);
    if (rows.length < PAGE) return all;
  }
}

async function loadClientAddresses(rest, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const rows = await rest(`clients?id=in.(${ids.slice(i, i + ID_BATCH).join(",")})&select=id,address`);
    for (const c of rows) if (c.address) out.set(c.id, c.address);
  }
  return out;
}

async function loadLocal(rest) {
  const rows = await rest("global_config?key=in.(local_lat,local_lng)&select=key,value");
  const read = (key, fallback) => {
    const value = Number(rows.find((r) => r.key === key)?.value);
    return Number.isFinite(value) ? value : fallback;
  };
  return { lat: read("local_lat", RESTAURANT_LOCATION.lat), lng: read("local_lng", RESTAURANT_LOCATION.lng) };
}

async function main() {
  const { apply, limit } = parseArgs(process.argv.slice(2));
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim().replace(/\/$/, "");
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL (o SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY.");

  const rest = createRest(url, key);
  const near = await loadLocal(rest);
  const summary = await runGeocodeBackfill(
    {
      loadOrders: () => loadOrders(rest),
      loadClientAddresses: (ids) => loadClientAddresses(rest, ids),
      patchOrder: (id, patch, onlyIfNoAddress) =>
        rest(`orders?id=eq.${id}${onlyIfNoAddress ? "&delivery_address=is.null" : "&delivery_lat=is.null"}`, { method: "PATCH", body: JSON.stringify(patch) }),
      search: (query, point) => geocodeAddress(query, point),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    },
    { apply, limit, near },
  );

  process.stdout.write(`${apply ? "APLICADO" : "DRY-RUN (no se escribió nada; usar --aplicar)"}\n`);
  process.stdout.write(`Tope de intentos por pedido: ${GEOCODE_MAX_ATTEMPTS}\n${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
