export interface CampaignClient {
  id: string;
  name: string;
  phone: string | null;
  tier: string;
  /** Aceptó recibir promociones por WhatsApp. */
  optedIn: boolean;
}

export interface CampaignOrder {
  client_id: string | null;
  created_at: string;
  status: string;
}

export type Segment =
  | { kind: "all" }
  | { kind: "inactive"; days: number }
  | { kind: "frequent"; minOrders: number }
  | { kind: "tier"; tier: string };

export interface Recipient {
  id: string;
  name: string;
  phone: string;
}

const DAY_MS = 86_400_000;
/** Ventana para contar la frecuencia de compra. */
const FREQUENT_WINDOW_DAYS = 60;

/**
 * A quién va una campaña. Regla fija: solo clientes con teléfono que aceptaron recibir
 * promociones; el segmento afina sobre ese grupo. Los pedidos cancelados no cuentan.
 */
export function selectRecipients(
  clients: readonly CampaignClient[],
  orders: readonly CampaignOrder[],
  segment: Segment,
  now: Date = new Date(),
): Recipient[] {
  const valid = orders.filter((o) => o.status !== "Cancelado" && o.client_id);
  const timesByClient = new Map<string, number[]>();
  for (const order of valid) {
    const list = timesByClient.get(order.client_id!) ?? [];
    list.push(new Date(order.created_at).getTime());
    timesByClient.set(order.client_id!, list);
  }

  const eligible = clients.filter((c): c is CampaignClient & { phone: string } => c.optedIn && Boolean(c.phone));

  const matches = (client: CampaignClient): boolean => {
    const times = timesByClient.get(client.id) ?? [];
    switch (segment.kind) {
      case "all":
        return true;
      case "tier":
        return client.tier === segment.tier;
      case "inactive": {
        const last = times.length > 0 ? Math.max(...times) : -Infinity;
        return now.getTime() - last > segment.days * DAY_MS;
      }
      case "frequent": {
        const since = now.getTime() - FREQUENT_WINDOW_DAYS * DAY_MS;
        return times.filter((t) => t >= since).length >= segment.minOrders;
      }
    }
  };

  return eligible.filter(matches).map((c) => ({ id: c.id, name: c.name, phone: c.phone }));
}
