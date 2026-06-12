import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { rateLimit, getClientIp } from "@/utils/rate-limit";

// Acciones permitidas y sus campos de datos aceptados
const ALLOWED_ACTIONS = new Set(["new_order", "status_update", "create_ticket"]);

const ACTION_DATA_FIELDS: Record<string, string[]> = {
  new_order:     ["orderId", "items", "price", "customerName", "timestamp"],
  status_update: ["orderId", "newStatus", "timestamp"],
  create_ticket: ["orderId", "description", "timestamp"],
};

function filterData(action: string, data: Record<string, unknown>): Record<string, unknown> {
  const allowed = ACTION_DATA_FIELDS[action] ?? [];
  return Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)));
}

export async function POST(req: Request) {
  // Autenticación requerida
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limiting estricto para el endpoint más sensible
  if (!rateLimit(getClientIp(req), 20, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  try {
    const body = await req.json() as { action?: string; data?: Record<string, unknown> };
    const { action, data = {} } = body;

    if (!action || typeof action !== "string" || !ALLOWED_ACTIONS.has(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

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
