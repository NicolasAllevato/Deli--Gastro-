import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { isDemoMode } from "@/lib/demo/mode";
import { createDemoBrowserClient } from "@/lib/demo/browser-client";

export function createClient() {
  if (isDemoMode()) return createDemoBrowserClient();

  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
