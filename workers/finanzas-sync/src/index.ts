import { syncDailyReport, type ReportEnv } from "./report.ts";

export type Env = ReportEnv;

/**
 * Worker cron (cada hora): agrega ingresos del día desde `orders` a `reports_daily`.
 * DATA_BACKEND="d1" → binding D1 `DB` únicamente. Otro valor → Supabase (secrets
 * SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY), ruta legada.
 */
export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      syncDailyReport(env).catch((error: unknown) => {
        console.error("[finanzas-sync]", error instanceof Error ? error.message : error);
        throw error;
      }),
    );
  },
};
