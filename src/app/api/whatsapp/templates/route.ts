import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { guardAdmin } from "@/lib/auth/adminGuard";
import { clientFor, loadWhatsAppSettings } from "@/lib/whatsapp/config";
import { WhatsAppApiError, type TemplateInfo } from "@/lib/whatsapp/client";
import { TEMPLATES, metaPayload, renderPreview, templateByName } from "@/lib/whatsapp/templates";

const NOT_CREATED = "NOT_CREATED";

const postSchema = z.object({ name: z.string().min(1).max(64) }).strict();

/** Catálogo de plantillas de la app con el estado de aprobación que informa Meta. */
export async function GET(req: NextRequest) {
  const denied = await guardAdmin(req, 60);
  if (denied) return denied;

  const wa = clientFor(await loadWhatsAppSettings(createAdminClient()));
  let remote: TemplateInfo[] = [];
  let metaError: string | null = null;

  if (wa) {
    try {
      remote = await wa.listTemplates();
    } catch (error: unknown) {
      metaError = error instanceof WhatsAppApiError ? error.message : "No se pudo consultar a Meta.";
    }
  }

  const statuses = new Map(remote.map((t) => [t.name, t.status]));
  return NextResponse.json({
    connected: wa !== null,
    metaError,
    templates: TEMPLATES.map((t) => ({
      name: t.name,
      label: t.label,
      category: t.category,
      purpose: t.purpose,
      footer: t.footer ?? null,
      preview: renderPreview(t, t.example),
      status: statuses.get(t.name) ?? NOT_CREATED,
    })),
  });
}

/** Crea en Meta una plantilla del catálogo. Queda pendiente hasta que Meta la apruebe. */
export async function POST(req: NextRequest) {
  const denied = await guardAdmin(req, 20);
  if (denied) return denied;

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  const template = parsed.success ? templateByName(parsed.data.name) : undefined;
  if (!template) return NextResponse.json({ error: "Plantilla desconocida." }, { status: 400 });

  const wa = clientFor(await loadWhatsAppSettings(createAdminClient()));
  if (!wa) return NextResponse.json({ error: "Conectá WhatsApp primero." }, { status: 400 });

  try {
    const created = await wa.createTemplate(metaPayload(template));
    return NextResponse.json({ name: template.name, status: created.status }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof WhatsAppApiError ? error.message : "No se pudo crear la plantilla.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
