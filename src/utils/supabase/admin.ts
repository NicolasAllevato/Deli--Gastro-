import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { cleanEnv } from "@/lib/clean-env";
import { isDemoMode } from "@/lib/demo/mode";
import { createDemoAdminClient } from "@/lib/demo/server-client";
import { dataBackend } from "@/lib/data";
import { createD1AdminClient } from "@/lib/d1-admin-client";

export function createAdminClient() {
  if (isDemoMode()) return createDemoAdminClient();
  // Corte a D1 (etapa 1): con DATA_BACKEND=d1 las consultas van a D1, no a Supabase.
  if (dataBackend() === "d1") return createD1AdminClient();

  return createClient<Database>(
    cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL),
    cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
