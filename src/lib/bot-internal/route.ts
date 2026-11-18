import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getClientIp, rateLimit } from "@/utils/rate-limit";
import { cleanEnv } from "@/lib/clean-env";
import { claimBotNonce, dataBackend } from "@/lib/data";
import { avisarReclamo } from "@/lib/reclamos/server";
import { handleBot } from "./handlers.ts";
import { readLimited } from "./read-body.ts";
import { MAX_BODY_BYTES } from "./signature.ts";
import type { BotOperation } from "./schemas.ts";

/** Adaptador fino entre un `route.ts` de Next y los handlers testeables. */
export async function runBotRoute(op: BotOperation, req: NextRequest): Promise<NextResponse> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, code: "too_large", error: "Cuerpo demasiado grande." }, { status: 413 });
  }
  const rawBody = await readLimited(req, MAX_BODY_BYTES);
  if (rawBody === null) {
    return NextResponse.json({ ok: false, code: "too_large", error: "Cuerpo demasiado grande." }, { status: 413 });
  }
  const result = await handleBot(
    op,
    {
      method: req.method,
      path: new URL(req.url).pathname,
      headers: req.headers,
      rawBody,
      ip: getClientIp(req),
    },
    {
      db: createAdminClient(),
      secrets: {
        current: cleanEnv(process.env.BOT_INTERNAL_SECRET),
        previous: cleanEnv(process.env.BOT_INTERNAL_SECRET_PREV),
      },
      rateLimit,
      // El registro de nonces vive en D1: con otro backend (demo, Supabase) no hay tabla.
      claimNonce: dataBackend() === "d1" ? claimBotNonce : undefined,
      // Los reclamos viven en D1: con otro backend no hay tabla.
      notifyReclamo: dataBackend() === "d1" ? avisarReclamo : undefined,
    },
  );
  return NextResponse.json(result.body, { status: result.status });
}
