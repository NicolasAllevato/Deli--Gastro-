"use client";

import { useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Switch } from "@/components/ui/Switch";
import {
  DEFAULT_PERMISSIONS, STAFF_ROLES, STAFF_ROLE_LABELS,
  type AccessLevel, type Section, type StaffRole,
} from "@/lib/auth/permissions";
import { STAFF_MIN_PASSWORD, type StaffUserPublic } from "@/lib/staff-users/types";
import { buildCreateBody, buildPatchBody, type UserFormState } from "../payload";
import { PermissionsEditor } from "./PermissionsEditor";
import { Segmented } from "./Segmented";

const ROLE_OPTIONS = STAFF_ROLES.map((value) => ({ value, label: STAFF_ROLE_LABELS[value] }));
const FORM_ID = "usuario-form";

interface UserFormModalProps {
  /** null = alta. */
  user: StaffUserPublic | null;
  /** Quien edita: sobre sí mismo solo se cambia el nombre. */
  currentUserId: string;
  onClose: () => void;
  onSaved: () => void;
}

async function send(url: string, method: "POST" | "PATCH", body: Record<string, unknown>): Promise<void> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return;
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new Error(json?.error ?? "No se pudo guardar. Probá de nuevo.");
}

export function UserFormModal({ user, currentUserId, onClose, onSaved }: UserFormModalProps) {
  const isNew = user === null;
  const isSelf = user?.id === currentUserId;
  const [form, setForm] = useState<UserFormState>({
    name: user?.name ?? "",
    email: user?.email ?? "",
    password: "",
    role: user?.staff_role ?? "cajero",
    permissions: user?.permissions ?? DEFAULT_PERMISSIONS.cajero,
    banned: user?.banned ?? false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (changes: Partial<UserFormState>) => setForm((f) => ({ ...f, ...changes }));
  // Al elegir un rol se precargan sus permisos; después se pueden ajustar sección por sección.
  const chooseRole = (role: StaffRole) => patch({ role, permissions: DEFAULT_PERMISSIONS[role] });
  const choosePermission = (section: Section, level: AccessLevel) => patch({ permissions: { ...form.permissions, [section]: level } });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (isNew && form.password.length < STAFF_MIN_PASSWORD) {
      setError(`La contraseña tiene que tener al menos ${STAFF_MIN_PASSWORD} caracteres.`);
      return;
    }
    const body = isNew ? buildCreateBody(form) : buildPatchBody(user, form);
    if (Object.keys(body).length === 0) {
      setError("No hay cambios para guardar.");
      return;
    }
    setSaving(true);
    try {
      await send(isNew ? "/api/admin/usuarios" : `/api/admin/usuarios/${user.id}`, isNew ? "POST" : "PATCH", body);
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "No se pudo guardar. Probá de nuevo.");
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isNew ? "Nuevo usuario" : "Editar usuario"}
      description={isNew ? "Cuenta del personal para entrar al panel. Al primer ingreso tiene que aceptar los Términos." : user.email}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form={FORM_ID} loading={saving}>{isNew ? "Crear usuario" : "Guardar cambios"}</Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto pr-1 -mr-1 custom-scrollbar">
        {isSelf && (
          <p className="text-xs text-gray-600 rounded-xl neumorphic-inset px-4 py-2.5" role="note">
            Es tu propio usuario: acá solo podés cambiar el nombre. Para la contraseña usá «¿Olvidaste tu contraseña?» en el ingreso.
          </p>
        )}
        <Field label="Nombre" required value={form.name} maxLength={120} onChange={(e) => patch({ name: e.target.value })} autoComplete="off" />
        {isNew && (
          <Field
            label="Email" type="email" required value={form.email} maxLength={254}
            onChange={(e) => patch({ email: e.target.value })} autoComplete="off"
          />
        )}
        {!isSelf && (
          <Field
            label={isNew ? "Contraseña inicial" : "Nueva contraseña"}
            type="password"
            required={isNew}
            value={form.password}
            maxLength={128}
            onChange={(e) => patch({ password: e.target.value })}
            autoComplete="new-password"
            hint={isNew
              ? `Mínimo ${STAFF_MIN_PASSWORD} caracteres. Pasásela por un canal seguro; puede cambiarla desde «¿Olvidaste tu contraseña?».`
              : "Opcional. Si la completás, se cierran sus sesiones abiertas y entra con esta."}
          />
        )}
        <Segmented
          name="usuario-rol"
          legend="Rol"
          options={ROLE_OPTIONS}
          value={form.role}
          onChange={chooseRole}
          disabled={isSelf}
        />
        <PermissionsEditor permissions={form.permissions} onChange={choosePermission} locked={form.role === "admin" || isSelf} />
        {!isNew && !isSelf && (
          <Switch
            checked={form.banned}
            onChange={(banned) => patch({ banned })}
            label="Acceso bloqueado"
            hint="Mientras esté bloqueado no puede ingresar y se cierran sus sesiones."
          />
        )}
        {error && <p role="alert" className="text-sm font-bold text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}
