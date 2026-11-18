import type { NextRequest } from "next/server";
import { cartaPdfResponse } from "@/lib/carta-pdf/handler";

/** Carta pública en PDF (la manda el bot de WhatsApp). URL estable: no cambiar. */
export async function GET(req: NextRequest) {
  return cartaPdfResponse(req);
}
