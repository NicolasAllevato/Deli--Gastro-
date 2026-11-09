import { GEOCODE_MAX_ATTEMPTS, geocodeOutcome } from "./geocode-match.ts";
import type { GeocodeResult } from "./geocode.ts";
import type { GeoPoint } from "./zones.ts";

/** Lógica del script `scripts/geocodificar-historico.mjs`. El acceso a la base y a Nominatim llega inyectado. */

export interface HistoricOrder {
  id: string;
  client_id: string | null;
  delivery_address: string | null;
  fudo_source: string | null;
  geocode_attempts: number;
}

export interface BackfillDeps {
  /** Pedidos de delivery de Fudo finalizados y sin coordenadas. */
  loadOrders: () => Promise<HistoricOrder[]>;
  loadClientAddresses: (clientIds: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  patchOrder: (id: string, patch: Record<string, unknown>, onlyIfNoAddress: boolean) => Promise<void>;
  search: (query: string, near: GeoPoint) => Promise<GeocodeResult[]>;
  sleep: (ms: number) => Promise<void>;
}

export interface BackfillOptions {
  apply: boolean;
  limit: number | null;
  near: GeoPoint;
}

export interface BackfillSummary {
  candidates: number;
  /** PedidosYa/Rappi no informan dirección: no se tocan. */
  skippedApps: number;
  addressFromClient: number;
  withoutAddress: number;
  toGeocode: number;
  located: number;
  rejected: number;
  errors: number;
  aborted: boolean;
}

const NOMINATIM_GAP_MS = 1100;
const MAX_CONSECUTIVE_ERRORS = 5;
const APPS_WITHOUT_ADDRESS: readonly (string | null)[] = ["pedidosya", "rappi"];

export function usableAddress(address: string | null | undefined): string | null {
  const clean = address?.trim();
  return clean && clean !== "-" ? clean : null;
}

/** Dry-run por defecto: solo cuenta. Con `apply`, copia la dirección del cliente y geocodifica de a un pedido por segundo. */
export async function runGeocodeBackfill(deps: BackfillDeps, options: BackfillOptions): Promise<BackfillSummary> {
  const all = await deps.loadOrders();
  const orders = all.filter((o) => !APPS_WITHOUT_ADDRESS.includes(o.fudo_source));
  const clientIds = [...new Set(orders.filter((o) => !usableAddress(o.delivery_address) && o.client_id).map((o) => o.client_id as string))];
  const clientAddresses = await deps.loadClientAddresses(clientIds);

  const planned = orders.map((order) => {
    const own = usableAddress(order.delivery_address);
    const copied = own || !order.client_id ? null : usableAddress(clientAddresses.get(order.client_id));
    return { order, copied, address: own ?? copied };
  });
  const located = planned.filter((p) => p.address !== null);
  const pending = located.filter((p) => p.order.geocode_attempts < GEOCODE_MAX_ATTEMPTS);
  const work = options.limit === null ? pending : pending.slice(0, options.limit);

  const summary: BackfillSummary = {
    candidates: all.length,
    skippedApps: all.length - orders.length,
    addressFromClient: planned.filter((p) => p.copied !== null).length,
    withoutAddress: planned.length - located.length,
    toGeocode: pending.length,
    located: 0,
    rejected: 0,
    errors: 0,
    aborted: false,
  };
  if (!options.apply) return summary;

  let consecutiveErrors = 0;
  for (const [index, { order, copied, address }] of work.entries()) {
    if (index > 0) await deps.sleep(NOMINATIM_GAP_MS);
    if (copied) await deps.patchOrder(order.id, { delivery_address: copied }, true);
    const outcome = await geocodeOutcome({ delivery_address: address, geocode_attempts: order.geocode_attempts }, options.near, deps.search);
    await deps.patchOrder(order.id, outcome.patch, false);
    if (outcome.kind === "located") summary.located += 1;
    if (outcome.kind === "rejected") summary.rejected += 1;
    if (outcome.kind === "error") summary.errors += 1;
    consecutiveErrors = outcome.kind === "error" ? consecutiveErrors + 1 : 0;
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      summary.aborted = true;
      break;
    }
  }
  return summary;
}
