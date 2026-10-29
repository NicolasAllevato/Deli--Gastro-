import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { isDemoMode } from "@/lib/demo/mode";
import { cleanEnv } from "@/lib/clean-env";
import { createDemoBrowserClient } from "@/lib/demo/browser-client";

export function createClient() {
  if (isDemoMode()) return createDemoBrowserClient();

  return createBrowserClient<Database>(
    cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL),
    cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
}
