/**
 * Sesión de repartidor sin contraseña (etapa 3): el servidor ya validó el PIN
 * (pin-attempts + hash con pepper) y abre una sesión normal de Better Auth.
 *
 * Seguridad:
 * - SERVER_ONLY: el router HTTP de Better Auth no monta este endpoint (better-call
 *   router.mjs salta los SERVER_ONLY), así que solo se llega por auth.api desde el código.
 * - Solo abre sesión a usuarios con role = 'repartidor' y no bloqueados.
 * - La cookie la firma Better Auth (setSessionCookie), con los mismos atributos del resto.
 */
import { createAuthEndpoint, APIError } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { BetterAuthPlugin } from "better-auth";
import { z } from "zod";

const body = z.object({ userId: z.string().min(1).max(64) });

export function courierSessionPlugin(): BetterAuthPlugin {
  return {
    id: "opsyn-courier-session",
    endpoints: {
      courierSession: createAuthEndpoint(
        "/opsyn/courier-session",
        { method: "POST", body, metadata: { SERVER_ONLY: true } },
        async (ctx) => {
          const user = (await ctx.context.internalAdapter.findUserById(ctx.body.userId)) as
            | ({ id: string; role?: string; banned?: boolean | number } & Record<string, unknown>)
            | null;
          if (!user || user.role !== "repartidor" || user.banned === true || user.banned === 1) {
            throw new APIError("FORBIDDEN", { message: "Repartidor no habilitado" });
          }
          const session = await ctx.context.internalAdapter.createSession(user.id);
          if (!session) throw new APIError("INTERNAL_SERVER_ERROR", { message: "No se pudo crear la sesión" });
          await setSessionCookie(ctx, { session, user: user as never });
          return ctx.json({ ok: true });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
