/**
 * Documentos que todo usuario acepta antes de entrar a su portal. Cambiar la `version` de
 * uno obliga a todos a volver a aceptarlo (el proxy compara LEGAL_BUNDLE_VERSION).
 */
export const LEGAL_DOCUMENTS = [
  { id: "terminos", version: "2026-10-14", title: "Términos y condiciones", href: "/terminos", cta: "Acepto los Términos y condiciones" },
  { id: "privacidad", version: "2026-10-14", title: "Política de privacidad", href: "/privacidad", cta: "Acepto la Política de privacidad" },
] as const;

export type LegalDocumentId = (typeof LEGAL_DOCUMENTS)[number]["id"];

/** Marca que el proxy exige en la sesión: cambia si cambia cualquier documento. */
export const LEGAL_BUNDLE_VERSION = LEGAL_DOCUMENTS.map((d) => `${d.id}@${d.version}`).join("|");

/** Cookie del modo demo que reemplaza a `app_metadata.legal_version` de Supabase. */
export const DEMO_LEGAL_COOKIE = "demo_legal";

export interface AcceptanceRow {
  document: string;
  version: string;
  accepted_at: string;
}

export interface LegalStatus {
  complete: boolean;
  pending: LegalDocumentId[];
  /** Fecha de aceptación de la versión vigente, por documento. */
  accepted: Partial<Record<LegalDocumentId, string>>;
}

export function isLegalDocumentId(value: unknown): value is LegalDocumentId {
  return typeof value === "string" && LEGAL_DOCUMENTS.some((d) => d.id === value);
}

/** Qué documentos tiene aceptados (en su versión vigente) y cuáles faltan. */
export function legalStatus(rows: readonly AcceptanceRow[]): LegalStatus {
  const accepted: Partial<Record<LegalDocumentId, string>> = {};
  for (const doc of LEGAL_DOCUMENTS) {
    const hit = rows.find((r) => r.document === doc.id && r.version === doc.version);
    if (hit) accepted[doc.id] = hit.accepted_at;
  }
  const pending = LEGAL_DOCUMENTS.filter((d) => !accepted[d.id]).map((d) => d.id);
  return { complete: pending.length === 0, pending, accepted };
}

/** Solo rutas internas: evita usar `redirectTo` para mandar al usuario a otro sitio. */
export function safeRedirect(target: string | null | undefined): string {
  if (!target || !target.startsWith("/") || target.startsWith("//") || target.includes("\\")) return "/";
  return target;
}
