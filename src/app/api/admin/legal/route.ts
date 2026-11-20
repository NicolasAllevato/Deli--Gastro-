import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { guardAdmin } from "@/lib/auth/adminGuard";
import { dataFor, systemActor, usesD1 } from "@/lib/data";
import {
  LEGAL_LIST_MAX_ROWS, groupLegalUsers, legalDocumentsView, type LegalAcceptanceListRow, type LegalUserRow,
} from "@/lib/legal/admin-list";

export type { LegalUserRow };

/** Aceptaciones, de la más reciente a la más vieja: con D1 salen de D1 (única fuente), si no, de Supabase. */
async function readAcceptances(): Promise<LegalAcceptanceListRow[]> {
  if (usesD1()) {
    // El permiso ya lo resolvió guardAdmin (rol admin y sección Configuración); la lista no depende de un usuario en particular.
    return (await dataFor(systemActor("admin-legal-list"))).legal.all(LEGAL_LIST_MAX_ROWS);
  }
  const { data, error } = await createAdminClient()
    .from("legal_acceptances")
    .select("user_id, email, role, document, version, accepted_at, ip")
    .order("accepted_at", { ascending: false })
    .limit(LEGAL_LIST_MAX_ROWS);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Estado de aceptación de Términos y Privacidad por usuario (solo admin). */
export async function GET(req: NextRequest) {
  const blocked = await guardAdmin(req, 30);
  if (blocked) return blocked;

  let rows: LegalAcceptanceListRow[];
  try {
    rows = await readAcceptances();
  } catch (error: unknown) {
    console.error("[legal] listado admin", error);
    return NextResponse.json({ error: "No se pudieron leer las aceptaciones." }, { status: 500 });
  }

  return NextResponse.json({
    documents: legalDocumentsView(),
    users: groupLegalUsers(rows),
    truncated: rows.length >= LEGAL_LIST_MAX_ROWS,
  });
}
