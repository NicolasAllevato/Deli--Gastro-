import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";

// Acciones permitidas y sus campos de datos aceptados.
// Sólo el portal admin dispara acciones de dispatch (ver src/utils/api.ts /
// TableroClient.tsx), por lo que este endpoint exige rol "admin".
const ACTION_DATA_FIELDS: Record<string, string[]> = {
  new_order:     ["orderId", "items", "price", "customerName", "timestamp"],
  status_update: ["orderId", "newStatus", "timestamp"],
  create_ticket: ["orderId", "description", "timestamp"],
};

const dispatchSchema = z.object({
  action: z.enum(["new_order", "status_update", "create_ticket"]),
  data: z.record(z.string(), z.unknown()).optional().default({}),
});

function filterData(action: string, data: Record<string, unknown>): Record<string, unknown> {
  const allowed = ACTION_DATA_FIELDS[action] ?? [];
  return Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)));
}

export async function POST(req: Request) {
  const auth = await requireRole("admin");
  if (isAuthorizationError(auth)) return auth.error;

  // Rate limiting estricto para el endpoint más sensible
  if (!(await rateLimit(getClientIp(req), 20, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  try {
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json({ error: "Body inválido." }, { status: 400 });
    }

    const parsed = dispatchSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
    const { action, data } = parsed.data;

    const webhookUrl = process.env.N8N_DISPATCHER_URL;
    if (!webhookUrl) {
      return NextResponse.json({ ok: true, note: "Dispatcher not configured" });
    }

    const safeData = filterData(action, data);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, data: safeData }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return NextResponse.json({ error: "Dispatcher error" }, { status: 502 });
      }
    } finally {
      clearTimeout(timeoutId);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ error: "Dispatcher timeout" }, { status: 504 });
    }
    console.error("Dispatch API Error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
