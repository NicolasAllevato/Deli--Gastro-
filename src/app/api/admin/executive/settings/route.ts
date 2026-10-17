import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { guardAdmin } from "@/lib/auth/adminGuard";
import { readConfig } from "@/lib/orders-server";
import { EXECUTIVE_SETTINGS_KEY, parseSettings, readLimitedJson, settingsFromStored } from "@/lib/reports/executiveSettings";
import type { Json } from "@/types/database";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const MAX_BODY_BYTES = 16_384;

const respond = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(req: NextRequest) {
  const denied = await guardAdmin(req, 60);
  if (denied) return denied;

  try {
    const config = await readConfig(createAdminClient());
    return respond(settingsFromStored(config[EXECUTIVE_SETTINGS_KEY]));
  } catch {
    return respond({ error: "No se pudieron leer los ajustes." }, 500);
  }
}

export async function PUT(req: NextRequest) {
  const denied = await guardAdmin(req, 20);
  if (denied) return denied;

  const body = await readLimitedJson(req, MAX_BODY_BYTES);
  if (body === undefined || body === null || typeof body !== "object" || Array.isArray(body)) {
    return respond({ error: "Body inválido o demasiado grande." }, 400);
  }

  try {
    const db = createAdminClient();
    const current = settingsFromStored((await readConfig(db))[EXECUTIVE_SETTINGS_KEY]);
    const parsed = parseSettings(body, current);
    if (!parsed.ok) return respond({ error: parsed.error }, 400);

    const { error } = await db
      .from("global_config")
      .upsert([{ key: EXECUTIVE_SETTINGS_KEY, value: parsed.settings as unknown as Json }], { onConflict: "key" });
    if (error) return respond({ error: "No se pudieron guardar los ajustes." }, 500);
    return respond(parsed.settings);
  } catch {
    return respond({ error: "No se pudieron guardar los ajustes." }, 500);
  }
}
