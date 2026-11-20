"use client";

import { createContext, useContext, type ReactNode } from "react";
import { levelAtLeast, staffAccessOf, type AccessLevel, type Section, type StaffAccess } from "@/lib/auth/permissions";

// Sin proveedor (por ejemplo una pantalla suelta en una prueba) se asume dueño: solo afecta lo que se muestra,
// el servidor valida cada pedido igual.
const AccessContext = createContext<StaffAccess>(staffAccessOf(null));

export function AdminAccessProvider({ access, children }: { access: StaffAccess; children: ReactNode }) {
  return <AccessContext.Provider value={access}>{children}</AccessContext.Provider>;
}

/** Acceso del usuario logueado, para mostrar u ocultar acciones. Lo que manda es el servidor. */
export function useAdminAccess(): StaffAccess {
  return useContext(AccessContext);
}

export function useSectionLevel(section: Section): AccessLevel {
  return useAdminAccess().permissions[section];
}

/**
 * Envuelve una pantalla de formularios: sin permiso de edición todos sus campos y botones quedan deshabilitados
 * (los enlaces y el texto siguen disponibles). Con permiso no cambia nada. Es presentación: el servidor valida igual.
 */
export function EditableArea({ section, children }: { section: Section; children: ReactNode }) {
  const canEdit = useCanEdit(section);
  return <fieldset disabled={!canEdit} className="m-0 min-w-0 border-0 p-0">{children}</fieldset>;
}

/** ¿Puede modificar esta sección? Con "ver" las pantallas siguen visibles pero sin acciones de edición. */
export function useCanEdit(section: Section): boolean {
  return levelAtLeast(useSectionLevel(section), "edit");
}
