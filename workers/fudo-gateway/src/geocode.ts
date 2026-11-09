import { geocodeAddress } from "../../../src/lib/geocode.ts";
import { GEOCODE_MAX_ATTEMPTS, geocodeOutcome, type GeocodeTarget } from "../../../src/lib/geocode-match.ts";
import { RESTAURANT_LOCATION } from "../../../src/lib/restaurant.ts";
import { rest, type DbEnv } from "./db.ts";

/**
 * Paso final de la sincronización: ubica unos pocos pedidos recién importados. Va después de todas las
 * escrituras y nunca lanza, así que no puede tumbar las ventas. Lo histórico lo hace `scripts/geocodificar-historico.mjs`.
 */

/** Tope por corrida. Cada pedido gasta 2 subrequests (Nominatim + PATCH) y el Worker tiene un límite bajo. */
export const MAX_GEOCODES_PER_RUN = 3;
/** Con más escrituras que esto la corrida ya gastó sus subrequests: se deja la geocodificación para la próxima. */
export const MAX_PRIOR_WRITES = 10;
/** Política de Nominatim: 1 pedido por segundo. */
const NOMINATIM_GAP_MS = 1100;
const NEW_ORDERS_WINDOW_HOURS = 72;

interface PendingOrder extends GeocodeTarget {
  id: string;
}

export interface GeocodeRunSummary {
  located: number;
  rejected: number;
  errors: number;
}

export interface GeocodeDeps {
  search?: typeof geocodeAddress;
  sleep?: (ms: number) => Promise<void>;
  now?: Date;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Cuántos pedidos se pueden geocodificar según lo que ya escribió esta corrida. */
export function geocodeQuota(priorWrites: number): number {
  return priorWrites > MAX_PRIOR_WRITES ? 0 : MAX_GEOCODES_PER_RUN;
}

function configNumber(rows: ReadonlyArray<{ key: string; value: unknown }>, key: string, fallback: number): number {
  const value = rows.find((r) => r.key === key)?.value;
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Sin la migración 027 la consulta falla y el paso queda inactivo sin afectar nada.
 * Si Nominatim falla se corta la tanda: insistir solo gasta subrequests y la cuota del servicio.
 */
export async function geocodeNewOrders(env: DbEnv, priorWrites: number, deps: GeocodeDeps = {}): Promise<GeocodeRunSummary> {
  const summary: GeocodeRunSummary = { located: 0, rejected: 0, errors: 0 };
  const quota = geocodeQuota(priorWrites);
  if (quota === 0) return summary;
  const search = deps.search ?? geocodeAddress;
  const sleep = deps.sleep ?? wait;
  const since = new Date((deps.now ?? new Date()).getTime() - NEW_ORDERS_WINDOW_HOURS * 3_600_000).toISOString();

  try {
    const pending = await rest<PendingOrder[]>(
      env,
      `orders?channel=eq.fudo&fudo_sale_type=eq.DELIVERY&delivery_address=not.is.null&delivery_lat=is.null&geocode_attempts=lt.${GEOCODE_MAX_ATTEMPTS}&created_at=gte.${since}&select=id,delivery_address,geocode_attempts&order=created_at.desc&limit=${quota}`,
    );
    if (pending.length === 0) return summary;
    const config = await rest<Array<{ key: string; value: unknown }>>(env, "global_config?key=in.(local_lat,local_lng)&select=key,value");
    const near = { lat: configNumber(config, "local_lat", RESTAURANT_LOCATION.lat), lng: configNumber(config, "local_lng", RESTAURANT_LOCATION.lng) };

    for (const [index, order] of pending.entries()) {
      if (index > 0) await sleep(NOMINATIM_GAP_MS);
      const outcome = await geocodeOutcome(order, near, search);
      await rest(env, `orders?id=eq.${order.id}&delivery_lat=is.null`, {
        method: "PATCH",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify(outcome.patch),
      });
      if (outcome.kind === "located") summary.located += 1;
      if (outcome.kind === "rejected") summary.rejected += 1;
      if (outcome.kind === "error") {
        summary.errors += 1;
        break;
      }
    }
  } catch (error: unknown) {
    // Ubicar pedidos es accesorio: la sincronización de ventas ya terminó y no debe verse afectada.
    console.error("[geocode] paso omitido", error instanceof Error ? error.message : "error");
    summary.errors += 1;
  }
  return summary;
}
