import { NextResponse } from "next/server";
import { dataBackend, getAuth } from "@/lib/data";
import { resolveEmailSender } from "@/lib/daily-summary/email";
import { getEmailBinding } from "@/lib/daily-summary/email-binding";

/**
 * Better Auth (etapa 3 del corte). Solo existe con DATA_BACKEND=d1: con Supabase responde 404
 * para que nadie pueda crear sesiones paralelas. /api/auth/courier-pin es una ruta propia y
 * tiene prioridad sobre este catch-all.
 */
async function sendResetPassword(to: string, url: string): Promise<void> {
  const sender = resolveEmailSender(undefined, { binding: await getEmailBinding() });
  if (!sender) {
    console.error("[auth] recuperación: no hay proveedor de correo configurado");
    return;
  }
  await sender.send({
    to,
    subject: "Restablecer tu contraseña de Opsyn Dely",
    text: `Para elegir una contraseña nueva entrá a este link (vence en 15 minutos y sirve una sola vez):\n${url}\n\nSi no lo pediste, ignorá este correo.`,
    html: `<p>Para elegir una contraseña nueva entrá a este link (vence en 15 minutos y sirve una sola vez):</p><p><a href="${encodeURI(url)}">Restablecer contraseña</a></p><p>Si no lo pediste, ignorá este correo.</p>`,
  });
}

async function handle(req: Request): Promise<Response> {
  if (dataBackend() !== "d1") return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const auth = await getAuth(sendResetPassword);
  return auth.handler(req);
}

export const GET = handle;
export const POST = handle;
