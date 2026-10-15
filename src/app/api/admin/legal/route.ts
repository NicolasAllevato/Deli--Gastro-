import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { guardAdmin } from "@/lib/auth/adminGuard";
import { LEGAL_DOCUMENTS, legalStatus, type LegalDocumentId } from "@/lib/legal/documents";

export interface LegalUserRow {
  userId: string;
  email: string | null;
  role: string | null;
  complete: boolean;
  accepted: Partial<Record<LegalDocumentId, string>>;
  lastIp: string | null;
}

const MAX_ROWS = 5000;

/** Estado de aceptación de Términos y Privacidad por usuario (solo admin). */
export async function GET(req: NextRequest) {
  const blocked = await guardAdmin(req, 30);
  if (blocked) return blocked;

  const { data, error } = await createAdminClient()
    .from("legal_acceptances")
    .select("user_id, email, role, document, version, accepted_at, ip")
    .order("accepted_at", { ascending: false })
    .limit(MAX_ROWS);
  if (error) {
    console.error("[legal] listado admin", error);
    return NextResponse.json({ error: "No se pudieron leer las aceptaciones." }, { status: 500 });
  }

  const byUser = new Map<string, typeof data>();
  for (const row of data ?? []) byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);

  const users: LegalUserRow[] = [...byUser.entries()].map(([userId, rows]) => {
    const status = legalStatus(rows);
    return {
      userId,
      email: rows[0]?.email ?? null,
      role: rows[0]?.role ?? null,
      complete: status.complete,
      accepted: status.accepted,
      lastIp: rows[0]?.ip ?? null,
    };
  });

  return NextResponse.json({
    documents: LEGAL_DOCUMENTS.map(({ id, title, version, href }) => ({ id, title, version, href })),
    users,
    truncated: (data ?? []).length >= MAX_ROWS,
  });
}
