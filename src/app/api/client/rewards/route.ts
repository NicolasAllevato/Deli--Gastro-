import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireClient } from "@/lib/auth/requireClient";
import { isAuthorizationError } from "@/lib/auth/requireRole";
import { REWARDS } from "@/lib/orders";
import { applyPointsDelta, getClientByUserId } from "@/lib/orders-server";

const redeemSchema = z.object({ rewardId: z.string().min(1).max(40) });

/** Canjea una recompensa: descuenta los puntos y deja el movimiento en el historial. */
export async function POST(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 10, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const auth = await requireClient();
  if (isAuthorizationError(auth)) return auth.error;

  const parsed = redeemSchema.safeParse(await req.json().catch(() => null));
  const reward = parsed.success ? REWARDS.find((r) => r.id === parsed.data.rewardId) : undefined;
  if (!reward) return NextResponse.json({ error: "Recompensa inválida." }, { status: 400 });

  const db = createAdminClient();
  // Saldo leído de nuevo del servidor: no se confía en lo que muestre la pantalla.
  const fresh = await getClientByUserId(db, auth.user.id);
  if (!fresh || fresh.total_points < reward.puntosRequeridos) {
    return NextResponse.json({ error: "No te alcanzan los puntos para este canje." }, { status: 409 });
  }

  const balance = await applyPointsDelta(
    db,
    fresh.id,
    -reward.puntosRequeridos,
    `Canje: ${reward.nombre}`,
    null,
  );

  return NextResponse.json({ ok: true, reward: reward.nombre, balance });
}
