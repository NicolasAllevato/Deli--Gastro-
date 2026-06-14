import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import type { Json } from "@/types/database";

export async function GET() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("global_config")
    .select("key, value");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const config = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  return NextResponse.json(config);
}

export async function PATCH(req: NextRequest) {
  const body = await req.json() as Record<string, unknown>;

  const rows = Object.entries(body).map(([key, value]) => ({ key, value: value as Json }));
  if (rows.length === 0) return NextResponse.json({ ok: true });

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("global_config")
    .upsert(rows, { onConflict: "key" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
