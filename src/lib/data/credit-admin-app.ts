/** Saldo a favor (administración) desde la app: binding D1 único (getDb). Las rutas no tocan el binding. */
import type { Actor } from "./actor.ts";
import {
  adjustCredit, creditHistory, expireCredits, readCreditConfig, searchCreditClients, writeCreditConfig,
  type AdjustmentInput, type CreditConfig,
} from "./credit-admin.ts";
import type { SqlDatabase } from "./sql.ts";

async function appDb(): Promise<SqlDatabase> {
  const { getDb } = await import("./db.ts");
  return getDb();
}

export const creditAdminApp = {
  config: async (actor: Actor) => readCreditConfig(await appDb(), actor),
  setConfig: async (actor: Actor, config: CreditConfig) => writeCreditConfig(await appDb(), actor, config),
  search: async (actor: Actor, query: string) => searchCreditClients(await appDb(), actor, query),
  history: async (actor: Actor, clientId: string) => creditHistory(await appDb(), actor, clientId),
  adjust: async (actor: Actor, input: AdjustmentInput) => adjustCredit(await appDb(), actor, input),
  expireAll: async (actor: Actor) => expireCredits(await appDb(), actor),
};

export type CreditAdminApp = typeof creditAdminApp;
