/**
 * Crea el usuario de prueba admin@deli-gastro.com / admin en Supabase.
 * Requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env.local
 *
 * Uso:
 *   node --env-file=.env.local scripts/create-admin-user.mjs
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Faltan credenciales. Asegurate de tener en .env.local:\n" +
    "  NEXT_PUBLIC_SUPABASE_URL\n" +
    "  SUPABASE_SERVICE_ROLE_KEY"
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await supabase.auth.admin.createUser({
  email: "admin@deli-gastro.com",
  password: "admin123",
  email_confirm: true,
  user_metadata: { role: "admin" },
});

if (error) {
  if (error.message.includes("already been registered")) {
    console.log("✓ El usuario admin@deli-gastro.com ya existe.");
  } else {
    console.error("Error al crear usuario:", error.message);
    process.exit(1);
  }
} else {
  console.log("✓ Usuario creado:");
  console.log("  Email:    admin@deli-gastro.com");
  console.log("  Password: admin");
  console.log("  ID:      ", data.user.id);
}
