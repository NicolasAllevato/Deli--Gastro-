import type { NextRequest } from "next/server";
import { runBotRoute } from "@/lib/bot-internal/route";

// Llamada interna firmada (con nonce) del Worker del bot: reclamo nuevo → aviso por mail al local.
export const POST = (req: NextRequest) => runBotRoute("reclamo", req);
