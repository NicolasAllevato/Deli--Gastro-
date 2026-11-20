/** Formas públicas de la eliminación de datos (API y pantallas). Sin datos personales de nadie. */

/** Lo que hay que escribir para confirmar. La pantalla lo normaliza (mayúsculas, sin espacios) antes de enviarlo. */
export const DELETION_CONFIRM_WORD = "ELIMINAR";

/** Igual que MIN_PASSWORD de la config de Better Auth: la contraseña actual puede tener más, hasta este tope. */
export const DELETION_MAX_PASSWORD = 128;

export interface DeletionCountRowView {
  key: string;
  table: string;
  action: "delete" | "anonymize";
  label: string;
  count: number;
}

/** Una cuenta o ficha que coincidió con el teléfono o email ingresado (sin teléfono, email ni nombre completo). */
export interface DeletionMatchView {
  id: string;
  kind: "user" | "client";
  /** Por qué dato coincidió. */
  matchedBy: "email" | "phone";
  /** direct = tiene ese dato; link = cuelga por id de algo que sí lo tiene. */
  via: "direct" | "link";
  /** Nombre abreviado ("Marta G."). */
  label: string;
  createdAt: string | null;
  role?: string;
  staffRole?: string | null;
  /** Cuentas: por qué no se puede eliminar, o null. */
  blockedReason?: string | null;
  source?: string | null;
  linkedUserId?: string | null;
}

export interface DeletionPreviewView {
  found: boolean;
  total: number;
  rows: DeletionCountRowView[];
  files: number;
  accounts: Array<{ role: string; staffRole: string | null }>;
  warnings: string[];
  blocked: { status: 403 | 409; reason: string } | null;
  matches: { users: DeletionMatchView[]; clients: DeletionMatchView[] };
  /** Más de una cuenta o ficha: hay que elegir cuáles eliminar (confirmedUserIds / confirmedClientIds). */
  requiresConfirmation: boolean;
}

export interface DeletionRequestRowView {
  id: string;
  channel: "admin" | "autoservicio" | "email";
  status: "pending" | "completed" | "partial" | "failed";
  requestedAt: string;
  completedAt: string | null;
  counts: Record<string, number>;
  total: number;
  error: string | null;
}

export interface DeletionResultView {
  requestId: string;
  found: boolean;
  status: "completed" | "partial";
  counts: Record<string, number>;
  total: number;
  files: { total: number; failed: number };
}

/** Respuesta de GET /api/admin/eliminar-datos. `preview` solo viene cuando se pidió por teléfono o email. */
export interface DeletionAdminListing {
  preview: DeletionPreviewView | null;
  recent: DeletionRequestRowView[];
}

/** Respuesta de GET /api/account/delete. */
export interface DeletionEligibilityView {
  canDelete: boolean;
  reason: string | null;
}

export const CHANNEL_LABELS: Readonly<Record<DeletionRequestRowView["channel"], string>> = {
  email: "Pedido por email",
  admin: "Desde el panel",
  autoservicio: "Desde la cuenta",
};

export const STATUS_LABELS: Readonly<Record<DeletionRequestRowView["status"], string>> = {
  completed: "Completado",
  partial: "Parcial",
  failed: "Falló",
  pending: "En curso",
};
