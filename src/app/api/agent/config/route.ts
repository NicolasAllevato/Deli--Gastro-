import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { guardAdmin } from "@/lib/auth/adminGuard";
import { isDemoMode } from "@/lib/demo/mode";
import { loadAgentSettings, loadOpenAIKey, saveOpenAIKey } from "@/lib/agent/settings";
import { maskSecret } from "@/lib/whatsapp/mask";

const putSchema = z.object({ openaiKey: z.string().trim().min(10, "La clave parece incompleta").max(300) }).strict();

async function currentState() {
  const db = createAdminClient();
  const [settings, key] = await Promise.all([loadAgentSettings(db), loadOpenAIKey(db)]);
  return {
    settings,
    keyHint: maskSecret(key),
    // openai: responde con el modelo real; demo: modelo de juguete; none: no puede responder.
    mode: key ? "openai" : isDemoMode() ? "demo" : "none",
  } as const;
}

export async function GET(req: NextRequest) {
  const denied = await guardAdmin(req, 60);
  if (denied) return denied;
  return NextResponse.json(await currentState());
}

/** Guarda la clave de OpenAI (solo escritura: nunca se devuelve completa). */
export async function PUT(req: NextRequest) {
  const denied = await guardAdmin(req, 20);
  if (denied) return denied;

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Body inválido." }, { status: 400 });
  }

  try {
    await saveOpenAIKey(createAdminClient(), parsed.data.openaiKey);
  } catch {
    return NextResponse.json({ error: "No se pudo guardar la clave." }, { status: 500 });
  }
  return NextResponse.json(await currentState());
}
