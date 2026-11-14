import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";
import { isDemoMode } from "@/lib/demo/mode";
import { cleanEnv } from "@/lib/clean-env";
import { createDemoServerClient } from "@/lib/demo/server-client";
import { dataBackend } from "@/lib/data";
import { createD1SessionClient } from "@/lib/d1-session-client";

export async function createClient() {
  if (isDemoMode()) return createDemoServerClient();
  // Etapa 3 del corte: sesión de Better Auth sobre D1.
  if (dataBackend() === "d1") return createD1SessionClient();

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
