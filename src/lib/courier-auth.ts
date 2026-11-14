import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import { DEMO_COOKIE, isDemoMode } from "@/lib/demo/mode";
import type { CourierAuth } from "@/lib/courier-pins";
import { mirrorAuthUser } from "@/lib/d1-mirror";

/** Dominio de los emails internos de los repartidores: nunca se les manda correo, entran con PIN. */
const COURIER_EMAIL_DOMAIN = "repartidores.dely.opsyn.app";
/** "Para siempre" para Supabase Auth: un repartidor desactivado no puede renovar su sesión. */
const BLOCKED_FOR = "876000h";

/** Alta y bloqueo de repartidores en Supabase Auth (en demo no hay Auth: ids al azar). */
export function courierAuth(): CourierAuth {
  if (isDemoMode()) {
    return {
      async createUser() { return { id: randomUUID() }; },
      async setBlocked() { return null; },
    };
  }

  const admin = createAdminClient();
  return {
    async createUser(name) {
      const { data, error } = await admin.auth.admin.createUser({
        email: `repartidor-${randomUUID().slice(0, 8)}@${COURIER_EMAIL_DOMAIN}`,
        // Contraseña que nadie conoce: el único ingreso es por PIN.
        password: randomBytes(32).toString("base64url"),
        email_confirm: true,
        app_metadata: { role: "repartidor" },
        user_metadata: { name },
      });
      if (error || !data.user) {
        console.error("[couriers] alta en Auth", error?.message);
        return { error: "No se pudo crear el usuario del repartidor." };
      }
      // D1 (modo dual): el usuario antes que el repartidor (FK couriers → "user").
      await mirrorAuthUser("couriers.auth-user", data.user);
      return { id: data.user.id };
    },
    async setBlocked(userId, blocked) {
      const { data, error } = await admin.auth.admin.updateUserById(userId, { ban_duration: blocked ? BLOCKED_FOR : "none" });
      if (error) {
        console.error("[couriers] bloqueo en Auth", error.message);
        return "No se pudo actualizar el acceso del repartidor.";
      }
      if (data.user) await mirrorAuthUser("couriers.auth-block", data.user);
      return null;
    },
  };
}

/**
 * Abre la sesión del repartidor en este navegador (cookies de Supabase), sin contraseña:
 * el servidor ya validó el PIN. Genera un magic link sin mandarlo y lo canjea acá mismo.
 */
export async function startCourierSession(userId: string): Promise<string | null> {
  if (isDemoMode()) {
    // La demo tiene una sola cuenta de repartidor: cualquier PIN válido entra como ella.
    (await cookies()).set(DEMO_COOKIE, "repartidor", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 8 });
    return null;
  }

  const admin = createAdminClient();
  const { data: found, error: findError } = await admin.auth.admin.getUserById(userId);
  const email = found?.user?.email;
  if (findError || !email) return "No encontramos el usuario del repartidor.";

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    console.error("[couriers] link de sesión", linkError?.message);
    return "No se pudo iniciar la sesión.";
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (error) {
    console.error("[couriers] canje de sesión", error.message);
    return "No se pudo iniciar la sesión.";
  }
  return null;
}
