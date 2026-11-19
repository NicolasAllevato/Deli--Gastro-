"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ACCESS_LEVEL_LABELS, SECTIONS, SECTION_LABELS, STAFF_ROLE_LABELS, type StaffRole } from "@/lib/auth/permissions";
import type { StaffUserPublic, StaffUsersListing } from "@/lib/staff-users/types";
import { formatDateTimeAR } from "@/lib/time-ar";
import { UserFormModal } from "./_components/UserFormModal";

type ModalState = { user: StaffUserPublic | null } | null;

const ROLE_TONE: Record<StaffRole, "orange" | "blue" | "yellow"> = { admin: "orange", gerente: "blue", cajero: "yellow" };
const fmtDate = (iso: string) => (iso ? formatDateTimeAR(iso, { dateStyle: "short" }) : "—");

class LoadError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function loadUsers(): Promise<StaffUsersListing> {
  const res = await fetch("/api/admin/usuarios", { cache: "no-store" });
  const json = (await res.json().catch(() => null)) as (StaffUsersListing & { error?: string }) | null;
  if (!res.ok || !json) throw new LoadError(json?.error ?? "No se pudieron cargar los usuarios.", res.status);
  return json;
}

function AccessSummary({ user }: { user: StaffUserPublic }) {
  if (user.staff_role === "admin") return <span className="text-gray-600">Acceso total</span>;
  const granted = SECTIONS.filter((s) => user.permissions[s] !== "none");
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={`Acceso de ${user.name || user.email}`}>
      {granted.map((s) => (
        <li key={s}>
          <Badge tone={user.permissions[s] === "edit" ? "green" : "blue"}>
            {SECTION_LABELS[s]}: {ACCESS_LEVEL_LABELS[user.permissions[s]]}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/** Por qué no se puede editar a este usuario (para el tooltip del botón deshabilitado). */
function blockedReason(superOwnerConfigured: boolean): string {
  return superOwnerConfigured
    ? "Solo el dueño principal puede modificar a otro dueño."
    : "No hay dueño principal configurado (SUPER_OWNER_EMAIL): por seguridad nadie puede modificar a otro dueño.";
}

function StatusBadge({ banned }: { banned: boolean }) {
  return banned ? <Badge tone="red">Bloqueado</Badge> : <Badge tone="green">Activo</Badge>;
}

export default function UsuariosPage() {
  const [data, setData] = useState<StaffUsersListing | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [modal, setModal] = useState<ModalState>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await loadUsers());
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof LoadError ? e : new LoadError("No se pudieron cargar los usuarios.", 0));
    }
  }, []);

  // Carga inicial: el setState ocurre dentro de la promesa, no en el cuerpo del efecto.
  useEffect(() => {
    let alive = true;
    loadUsers()
      .then((next) => alive && setData(next))
      .catch((e: unknown) => alive && setError(e instanceof LoadError ? e : new LoadError("No se pudieron cargar los usuarios.", 0)));
    return () => {
      alive = false;
    };
  }, []);

  const saved = () => {
    setModal(null);
    void refresh();
  };

  return (
    <div className="page-fade flex flex-col gap-4 p-2">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-headline text-2xl font-black text-gray-800">Usuarios</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Quién del personal entra al panel y a qué secciones. El dueño ve y edita todo; a gerentes y cajeros les
            elegís el acceso sección por sección.
          </p>
        </div>
        {data && (
          <Button leftIcon={<Plus size={16} aria-hidden />} onClick={() => setModal({ user: null })}>
            Nuevo usuario
          </Button>
        )}
      </header>

      {data && !data.superOwnerConfigured && (
        <p role="note" className="text-xs text-gray-600 rounded-xl neumorphic-inset px-4 py-2.5 max-w-3xl">
          No hay dueño principal configurado (variable SUPER_OWNER_EMAIL del Worker). Mientras tanto, por seguridad, no se
          pueden crear dueños ni editar a otros dueños: cada dueño solo cambia su nombre y su contraseña, y podés gestionar
          gerentes y cajeros.
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm font-bold text-red-600">
          {error.status === 501 ? "La gestión de usuarios solo está disponible con la base D1." : error.message}
        </p>
      )}
      {!data && !error && <div className="h-40 rounded-2xl shimmer" aria-hidden />}

      {data && (
        <>
          <section aria-labelledby="usuarios-personal" className="flex flex-col gap-2">
            <h2 id="usuarios-personal" className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Personal del local</h2>
            <div className="neumorphic rounded-2xl overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-widest text-gray-500">
                    <th className="px-4 py-3">Usuario</th>
                    <th className="px-4 py-3">Rol</th>
                    <th className="px-4 py-3">Acceso</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3"><span className="sr-only">Acciones</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">Todavía no hay usuarios.</td></tr>
                  )}
                  {data.users.map((u) => (
                    <tr key={u.id} className="border-t border-gray-200/60 align-top">
                      <td className="px-4 py-3">
                        <p className="font-bold text-gray-800">{u.name || "Sin nombre"}{u.id === data.currentUserId && <span className="ml-2 text-[11px] font-bold text-gray-500">(vos)</span>}</p>
                        <p className="text-xs text-gray-500">{u.email}</p>
                        {u.isSuperOwner && <Badge tone="orange" className="mt-1">Dueño principal</Badge>}
                      </td>
                      <td className="px-4 py-3"><Badge tone={ROLE_TONE[u.staff_role]}>{STAFF_ROLE_LABELS[u.staff_role]}</Badge></td>
                      <td className="px-4 py-3 max-w-md"><AccessSummary user={u} /></td>
                      <td className="px-4 py-3"><StatusBadge banned={u.banned} /></td>
                      <td className="px-4 py-3 text-right">
                        {/* El tooltip va en el contenedor: un botón deshabilitado no siempre lo muestra. */}
                        <span title={u.canEdit ? undefined : blockedReason(data.superOwnerConfigured)} className="inline-flex">
                          <Button
                            variant="icon"
                            size="sm"
                            disabled={!u.canEdit}
                            aria-label={u.canEdit
                              ? `Editar a ${u.name || u.email}`
                              : `Editar a ${u.name || u.email} (no disponible: ${blockedReason(data.superOwnerConfigured)})`}
                            onClick={() => setModal({ user: u })}
                          >
                            <Pencil size={15} aria-hidden />
                          </Button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="usuarios-repartidores" className="flex flex-col gap-2">
            <h2 id="usuarios-repartidores" className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Repartidores</h2>
            <p className="text-xs text-gray-500">
              Solo lectura: los repartidores se gestionan en{" "}
              <Link href="/admin/repartidores" className="font-bold text-brand-orange hover:underline">Pedidos &gt; Repartidores</Link>.
            </p>
            <div className="neumorphic rounded-2xl overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-widest text-gray-500">
                    <th className="px-4 py-3">Nombre</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3">Alta</th>
                  </tr>
                </thead>
                <tbody>
                  {data.couriers.length === 0 && (
                    <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-500">No hay repartidores cargados.</td></tr>
                  )}
                  {data.couriers.map((c) => (
                    <tr key={c.id} className="border-t border-gray-200/60">
                      <td className="px-4 py-3 font-bold text-gray-800">{c.name || "Sin nombre"}</td>
                      <td className="px-4 py-3"><StatusBadge banned={c.banned} /></td>
                      <td className="px-4 py-3 text-gray-600">{fmtDate(c.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {modal && data && (
        <UserFormModal
          key={modal.user?.id ?? "nuevo"}
          user={modal.user}
          currentUserId={data.currentUserId}
          viewerIsSuperOwner={data.isSuperOwner}
          onClose={() => setModal(null)}
          onSaved={saved}
        />
      )}
    </div>
  );
}
