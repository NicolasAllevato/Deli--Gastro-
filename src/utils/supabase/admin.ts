import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

function readEnv(key: string): string {
  const v = process.env[key] ?? "";
  // Strip BOM (U+FEFF) that PowerShell piping can prepend to env var values
  return v.charCodeAt(0) === 0xfeff ? v.slice(1) : v;
}

export function createAdminClient() {
  return createClient<Database>(
    readEnv("NEXT_PUBLIC_SUPABASE_URL"),
    readEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
