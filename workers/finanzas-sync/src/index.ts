export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

interface OrderRow {
  total: number;
  status: string;
  created_at: string;
}

function todayISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function syncDailyReport(env: Env): Promise<void> {
  const today = todayISODate(new Date());
  const startOfDay = `${today}T00:00:00.000Z`;
  const endOfDay = `${today}T23:59:59.999Z`;

  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY.trim(),
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY.trim()}`,
  };

  const ordersRes = await fetch(
    `${env.SUPABASE_URL.trim()}/rest/v1/orders?select=total,status,created_at` +
      `&created_at=gte.${startOfDay}&created_at=lte.${endOfDay}`,
    { headers },
  );

  if (!ordersRes.ok) {
    throw new Error(`Error leyendo orders: ${await ordersRes.text()}`);
  }

  const orders = (await ordersRes.json()) as OrderRow[];

  const totalOrders = orders.length;
  const ordersCancelled = orders.filter((o) => o.status === "Cancelado").length;
  const totalIncome = orders
    .filter((o) => o.status !== "Cancelado")
    .reduce((sum, o) => sum + Number(o.total ?? 0), 0);

  // `on_conflict=report_date` es obligatorio: sin él PostgREST resuelve el
  // merge sobre la PK (`id`, aleatoria) y a partir de la 2da corrida del día
  // el insert choca con `unique(report_date)` (409) y el reporte queda
  // congelado con los datos de la primera hora.
  const upsertRes = await fetch(`${env.SUPABASE_URL.trim()}/rest/v1/reports_daily?on_conflict=report_date`, {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      report_date: today,
      total_income: totalIncome,
      total_orders: totalOrders,
      orders_cancelled: ordersCancelled,
      generated_at: new Date().toISOString(),
    }),
  });

  if (!upsertRes.ok) {
    throw new Error(`Error escribiendo reports_daily: ${await upsertRes.text()}`);
  }
}

/**
 * Worker cron (cada hora): agrega ingresos/egresos del día desde `orders`
 * a `reports_daily`, sin mantener despierto el servidor Next.js.
 *
 * Deploy: `npx wrangler deploy` desde este directorio, después de:
 *   npx wrangler secret put SUPABASE_URL
 *   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
 */
export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(syncDailyReport(env));
  },
};
