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

// IMPORTANTE: el rol se guarda en `app_metadata`, NUNCA en `user_metadata`.
// `app_metadata` sólo puede escribirse con el service role (server-side),
// por lo que un usuario autenticado no puede auto-otorgarse el rol "admin"
// llamando a `supabase.auth.updateUser()` desde el cliente.
const { data, error } = await supabase.auth.admin.createUser({
  email: "admin@deli-gastro.com",
  password: "admin123",
  email_confirm: true,
  app_metadata: { role: "admin" },
});

if (error) {
  if (error.message.includes("already been registered")) {
    console.log("✓ El usuario admin@deli-gastro.com ya existe. Verificando/actualizando su rol...");

    const { data: usersPage, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) {
      console.error("Error al buscar el usuario existente:", listError.message);
      process.exit(1);
    }

    const existing = usersPage.users.find((u) => u.email === "admin@deli-gastro.com");
    if (!existing) {
      console.error("No se pudo encontrar el usuario admin@deli-gastro.com para actualizar su rol.");
      process.exit(1);
    }

    if (existing.app_metadata?.role !== "admin") {
      const { error: updateError } = await supabase.auth.admin.updateUserById(existing.id, {
        app_metadata: { ...existing.app_metadata, role: "admin" },
      });
      if (updateError) {
        console.error("Error al actualizar el rol del admin:", updateError.message);
        process.exit(1);
      }
      console.log("✓ Rol admin asignado en app_metadata.");
    } else {
      console.log("✓ El usuario ya tiene rol admin en app_metadata.");
    }
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
