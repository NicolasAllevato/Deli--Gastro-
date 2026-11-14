import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { guardAdmin } from "@/lib/auth/adminGuard";
import { isDemoMode } from "@/lib/demo/mode";
import { runAgent } from "@/lib/agent/loop";
import { createOpenAI } from "@/lib/agent/openai";
import { loadAgentSettings, loadOpenAIKey } from "@/lib/agent/settings";
import type { ChatMessage, LLM } from "@/lib/agent/types";
import {
  deliveryTimes, newVsReturning, recurringCustomers, reviewsSummary, salesSummary, productSales,
} from "@/lib/reports/analytics";
import { loadReportData } from "@/lib/reports/data";
import { createDemoReportsLlm } from "@/lib/reports/demoLlm";
import { RANGE_KEYS, RANGE_LABELS, rangeBounds, type RangeKey } from "@/lib/reports/range";
import { buildReportTools, buildReportsPrompt } from "@/lib/reports/tools";
import { formatDateAR } from "@/lib/time-ar";

const rangeSchema = z.enum(RANGE_KEYS as [RangeKey, ...RangeKey[]]);
const TOP = 5;

const chatSchema = z.object({
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(30),
});

const FALLBACK = "No pude armar el informe. Probá de nuevo o reformulá la pregunta.";

async function resolveLlm(db: ReturnType<typeof createAdminClient>): Promise<LLM | null> {
  const apiKey = await loadOpenAIKey(db);
  if (apiKey) return createOpenAI({ apiKey, model: (await loadAgentSettings(db)).model });
  return isDemoMode() ? createDemoReportsLlm() : null;
}

/** Resumen del período para el tablero de informes (sin IA: no gasta tokens). */
export async function GET(req: NextRequest) {
  const denied = await guardAdmin(req, 60);
  if (denied) return denied;

  const range = rangeSchema.safeParse(req.nextUrl.searchParams.get("range") ?? "last_7_days");
  if (!range.success) return NextResponse.json({ error: "Período inválido." }, { status: 400 });

  const data = await loadReportData(createAdminClient());
  const bounds = rangeBounds(range.data);

  return NextResponse.json({
    range: range.data,
    label: RANGE_LABELS[range.data],
    sales: salesSummary(data.orders, bounds, "day"),
    channels: salesSummary(data.orders, bounds, "channel").groups,
    // Dos tablas: combos (con su monto) y productos (sueltos + lo que vino dentro de combos, esto último a $0).
    ...(({ combos, products }) => ({ topCombos: combos, topProducts: products }))(productSales(data.orders, bounds, data.priceByName, TOP, data.comboRules)),
    recurring: recurringCustomers(data.orders, bounds, data.clients, 2).slice(0, TOP),
    customers: newVsReturning(data.orders, bounds),
    times: deliveryTimes(data.orders, bounds),
    reviews: reviewsSummary(data.reviews, bounds),
  });
}

/** Pregunta en lenguaje natural al analista (herramientas de solo lectura). */
export async function POST(req: NextRequest) {
  const denied = await guardAdmin(req, 20);
  if (denied) return denied;

  const parsed = chatSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || parsed.data.history.at(-1)?.role !== "user") {
    return NextResponse.json({ error: "Escribí tu pregunta." }, { status: 400 });
  }

  const db = createAdminClient();
  const llm = await resolveLlm(db);
  if (!llm) return NextResponse.json({ error: "Cargá la clave de OpenAI en Agente IA para usar el analista." }, { status: 400 });

  try {
    const today = formatDateAR(new Date(), {
      dateStyle: "full",
    });
    const result = await runAgent({
      llm,
      system: buildReportsPrompt(today),
      history: parsed.data.history as ChatMessage[],
      tools: buildReportTools(await loadReportData(db)),
      fallbackReply: FALLBACK,
    });
    return NextResponse.json({ reply: result.reply, tokens: result.tokens });
  } catch {
    return NextResponse.json({ error: "El analista no pudo responder. Revisá la clave de OpenAI." }, { status: 502 });
  }
}
