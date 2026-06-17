import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import type { Json } from "@/types/database";

async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  if (!(await rateLimit(getClientIp(req), 60, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  return null;
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("global_config")
    .select("key, value");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const config = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  return NextResponse.json(config);
}

export async function PATCH(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const body = await req.json() as Record<string, unknown>;

  const rows: Array<{ key: string; value: Json }> = Object.entries(body).map(([key, value]) => ({ key, value: value as Json }));
  if (rows.length === 0) return NextResponse.json({ ok: true });

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("global_config")
    .upsert(rows, { onConflict: "key" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
