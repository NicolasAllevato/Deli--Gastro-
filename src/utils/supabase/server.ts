import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";
import { isDemoMode } from "@/lib/demo/mode";
import { cleanEnv } from "@/lib/clean-env";
import { createDemoServerClient } from "@/lib/demo/server-client";

export async function createClient() {
  if (isDemoMode()) return createDemoServerClient();

  const cookieStore = await cookies();

  return createServerClient<Database>(
    cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL),
    cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // En Server Components el set es no-op; el middleware refresca la sesión
          }
        },
      },
    },
  );
}
