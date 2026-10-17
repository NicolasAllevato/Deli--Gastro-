import type { WhatsAppClient } from "./client.ts";

export type CheckStatus = "ok" | "error" | "pending";

export interface Check {
  status: CheckStatus;
  detail: string;
}

export interface Diagnosis {
  phone: Check;
  waba: Check;
  subscription: Check;
  /** Todo listo para enviar y recibir. */
  ready: boolean;
}

type DiagnoseClient = Pick<WhatsAppClient, "getPhoneInfo" | "getWabaInfo" | "isAppSubscribed">;

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Chequea la vinculación paso a paso: número, cuenta (WABA) y suscripción de la app.
 * Cada paso informa su propio error para que el admin sepa exactamente qué corregir.
 */
export async function diagnose(client: DiagnoseClient, hasWaba: boolean): Promise<Diagnosis> {
  let phone: Check;
  try {
    const info = await client.getPhoneInfo();
    const quality = info.quality_rating ? ` · calidad ${info.quality_rating}` : "";
    phone = { status: "ok", detail: `${info.verified_name} · ${info.display_phone_number}${quality}` };
  } catch (error: unknown) {
    phone = { status: "error", detail: errorText(error, "No se pudo leer el número.") };
  }

  if (!hasWaba) {
    const missing: Check = { status: "pending", detail: "Falta cargar el WABA ID." };
    return { phone, waba: missing, subscription: missing, ready: false };
  }

  let waba: Check;
  try {
    const info = await client.getWabaInfo();
    waba = { status: "ok", detail: info.name ?? info.id };
  } catch (error: unknown) {
    waba = { status: "error", detail: errorText(error, "No se pudo leer la cuenta de WhatsApp Business.") };
  }

  let subscription: Check;
  if (waba.status !== "ok") {
    subscription = { status: "pending", detail: "Primero corregí el WABA ID." };
  } else {
    try {
      subscription = (await client.isAppSubscribed())
        ? { status: "ok", detail: "La app recibe los mensajes de la cuenta." }
        : { status: "pending", detail: "La app no está suscrita: los mensajes no van a llegar al webhook." };
    } catch (error: unknown) {
      subscription = { status: "error", detail: errorText(error, "No se pudo consultar la suscripción.") };
    }
  }

  return {
    phone,
    waba,
    subscription,
    ready: phone.status === "ok" && waba.status === "ok" && subscription.status === "ok",
  };
}
