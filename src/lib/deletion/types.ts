/** Formas públicas de la eliminación de usuarios (API y pantallas). Sin contraseñas, hashes ni datos de la cuenta más allá del nombre y el email. */

/** Autoservicio: lo que hay que escribir para confirmar. La pantalla lo normaliza (mayúsculas, sin espacios) antes de enviarlo. */
export const DELETION_CONFIRM_WORD = "ELIMINAR";

/** La contraseña actual puede tener hasta este largo (igual que el tope de Better Auth). */
export const DELETION_MAX_PASSWORD = 128;

/** Un usuario del personal que se puede elegir para eliminar. */
export interface StaffUserView {
  id: string;
  name: string;
  email: string;
  staffRole: "admin" | "gerente" | "cajero";
  banned: boolean;
  createdAt: string | null;
  /** Por qué no se puede eliminar (dueño principal, último dueño activo), o null. */
  blockedReason: string | null;
}

export interface DeletionPreviewView {
  user: StaffUserView;
  /** Qué se borra y cuántas filas. */
  deletes: Array<{ key: string; label: string; count: number }>;
  /** Qué se conserva. */
  keeps: readonly string[];
  /** Código de un solo uso (5 minutos) que exige la ejecución; null si el usuario está protegido. */
  token: string | null;
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
  status: "completed";
  counts: Record<string, number>;
  total: number;
  /** Aviso por email al usuario eliminado: enviado, fallido (el borrado vale igual) u omitido (sin proveedor de correo). */
  notified: "sent" | "failed" | "skipped";
}

/** Respuesta de GET /api/admin/eliminar-datos. */
export interface DeletionAdminListing {
  users: StaffUserView[];
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
