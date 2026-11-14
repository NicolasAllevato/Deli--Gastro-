import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { isDemoMode } from "@/lib/demo/mode";
import { cleanEnv } from "@/lib/clean-env";
import { createDemoBrowserClient } from "@/lib/demo/browser-client";
import { createD1BrowserClient } from "@/lib/d1-browser-client";

/**
 * NEXT_PUBLIC_DATA_BACKEND se fija en el build y tiene que coincidir con DATA_BACKEND del
 * servidor (runbook del corte). Solo cambia por dónde entra y sale la sesión.
 */
export function createClient() {
  if (isDemoMode()) return createDemoBrowserClient();
  if (process.env.NEXT_PUBLIC_DATA_BACKEND?.trim().toLowerCase() === "d1") return createD1BrowserClient();

  return createBrowserClient<Database>(
    cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL),
    cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
}
