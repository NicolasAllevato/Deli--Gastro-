import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { cleanEnv } from "@/lib/clean-env";
import { isDemoMode } from "@/lib/demo/mode";
import { createDemoAdminClient } from "@/lib/demo/server-client";

export function createAdminClient() {
  if (isDemoMode()) return createDemoAdminClient();

  return createClient<Database>(
    cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL),
    cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
