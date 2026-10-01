import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { isDemoMode } from "@/lib/demo/mode";
import { createDemoAdminClient } from "@/lib/demo/server-client";

function readEnv(key: string): string {
  const v = process.env[key] ?? "";
  // Strip BOM (U+FEFF) that PowerShell piping can prepend to env var values
  return v.charCodeAt(0) === 0xfeff ? v.slice(1) : v;
}

export function createAdminClient() {
  if (isDemoMode()) return createDemoAdminClient();

  return createClient<Database>(
    readEnv("NEXT_PUBLIC_SUPABASE_URL"),
    readEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
