/**
 * Lista de aceptación de Términos y Privacidad por usuario para el panel (/admin/legal). Módulo puro: lo usan la ruta
 * (con Supabase o con D1) y las pruebas.
 */
import { LEGAL_DOCUMENTS, legalStatus, type LegalDocumentId } from "./documents.ts";

export interface LegalUserRow {
  userId: string;
  email: string | null;
  role: string | null;
  complete: boolean;
  accepted: Partial<Record<LegalDocumentId, string>>;
  lastIp: string | null;
}

/** Una aceptación tal como se guarda, con el dato del usuario que la hizo. */
export interface LegalAcceptanceListRow {
  user_id: string;
  email: string | null;
  role: string | null;
  document: string;
  version: string;
  accepted_at: string;
  ip: string | null;
}

export const LEGAL_LIST_MAX_ROWS = 5000;

export const legalDocumentsView = () => LEGAL_DOCUMENTS.map(({ id, title, version, href }) => ({ id, title, version, href }));

/** Agrupa por usuario. `rows` viene de la más reciente a la más vieja: el email, el rol y la IP son los de la última aceptación. */
export function groupLegalUsers(rows: readonly LegalAcceptanceListRow[]): LegalUserRow[] {
  const byUser = new Map<string, LegalAcceptanceListRow[]>();
  for (const row of rows) byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);
  return [...byUser.entries()].map(([userId, userRows]) => {
    const status = legalStatus(userRows);
    return {
      userId,
      email: userRows[0]?.email ?? null,
      role: userRows[0]?.role ?? null,
      complete: status.complete,
      accepted: status.accepted,
      lastIp: userRows[0]?.ip ?? null,
    };
  });
}
