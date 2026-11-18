import type { NextRequest } from "next/server";
import { cartaPdfResponse } from "@/lib/carta-pdf/handler";

/** Link fijo y corto para el QR de las mesas: la misma carta que /api/public/carta.pdf. */
export async function GET(req: NextRequest) {
  return cartaPdfResponse(req);
}
