import type { NextRequest } from "next/server";
import { runBotRoute } from "@/lib/bot-internal/route";

// Llamada interna firmada del Worker del bot: ver docs/PLAN_WORKER_BOT.md (Fase 5).
export const POST = (req: NextRequest) => runBotRoute("status", req);
