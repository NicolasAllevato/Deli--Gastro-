import {
  LayoutDashboard, Package, ShoppingBag, MessagesSquare, Hexagon, Settings, type LucideIcon,
} from "lucide-react";
import { canAccessPath, type Section, type StaffAccess } from "@/lib/auth/permissions";

export interface NavTab {
  href: string;
  label: string;
}

export interface NavSection {
  label: string;
  /** Sección de permisos a la que pertenece (src/lib/auth/permissions.ts). */
  section: Section;
  icon: LucideIcon;
  /** Ruta a la que lleva el ítem del panel lateral. */
  href: string;
  /** Pestañas internas; vacío si la sección es una sola página. */
  tabs: ReadonlyArray<NavTab>;
  /** Contador que se muestra en el menú lateral (p. ej. reclamos abiertos). */
  badge?: "reclamos";
}

export const NAV_SECTIONS: ReadonlyArray<NavSection> = [
  {
    label: "Dashboard", section: "dashboard", icon: LayoutDashboard, href: "/admin/ejecutivo",
    tabs: [
      { href: "/admin/ejecutivo", label: "Resumen" },
      { href: "/admin/informes", label: "Informes" },
    ],
  },
  {
    label: "Pedidos", section: "pedidos", icon: Package, href: "/admin/tablero",
    tabs: [
      { href: "/admin/tablero", label: "Tablero" },
      { href: "/admin/pedidos", label: "Historial" },
      { href: "/admin/mapa", label: "Mapa" },
      { href: "/admin/repartidores", label: "Repartidores" },
    ],
  },
  {
    label: "Catálogo", section: "catalogo", icon: ShoppingBag, href: "/admin/productos",
    tabs: [
      { href: "/admin/productos", label: "Productos" },
      { href: "/admin/puntos", label: "Puntos" },
    ],
  },
  {
    label: "Comunicación", section: "comunicacion", icon: MessagesSquare, href: "/admin/conversaciones", badge: "reclamos",
    tabs: [
      { href: "/admin/conversaciones", label: "Conversaciones" },
      { href: "/admin/reclamos", label: "Reclamos" },
      { href: "/admin/agente", label: "Agente IA" },
      { href: "/admin/conocimiento", label: "Conocimiento" },
      { href: "/admin/plantillas", label: "Plantillas" },
      { href: "/admin/campanas", label: "Campañas" },
      { href: "/admin/whatsapp", label: "Conexión" },
    ],
  },
  { label: "Zonas de entrega", section: "zonas", icon: Hexagon, href: "/admin/zonas", tabs: [] },
  {
    label: "Configuración", section: "configuracion", icon: Settings, href: "/admin/configuracion",
    tabs: [
      { href: "/admin/configuracion", label: "General" },
      { href: "/admin/carta", label: "Carta" },
      { href: "/admin/fudo", label: "Fudo" },
      { href: "/admin/promos", label: "Promos del día" },
      { href: "/admin/notificaciones", label: "Notificaciones" },
      { href: "/admin/usuarios", label: "Usuarios" },
      { href: "/admin/legal", label: "Documentos legales" },
    ],
  },
];

const isWithin = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

/**
 * Menú que ve este usuario: solo las pestañas a las que puede entrar (con al menos "ver"; Usuarios, solo el dueño).
 * Una sección sin pestañas visibles no aparece, y su enlace apunta a la primera pestaña que sí puede abrir.
 * Es solo presentación: la autorización la decide siempre el servidor (proxy y guards de las rutas).
 */
export function visibleNavSections(access: StaffAccess): ReadonlyArray<NavSection> {
  return NAV_SECTIONS.flatMap((s) => {
    if (s.tabs.length === 0) return canAccessPath(access, s.href) ? [s] : [];
    const tabs = s.tabs.filter((t) => canAccessPath(access, t.href));
    if (tabs.length === 0) return [];
    const href = tabs.some((t) => t.href === s.href) ? s.href : tabs[0].href;
    return [{ ...s, href, tabs }];
  });
}

export function findSection(
  pathname: string | null,
  sections: ReadonlyArray<NavSection> = NAV_SECTIONS,
): NavSection | undefined {
  if (!pathname) return undefined;
  return sections.find((s) =>
    isWithin(pathname, s.href) || s.tabs.some((t) => isWithin(pathname, t.href)),
  );
}

export function isTabActive(pathname: string | null, tab: NavTab): boolean {
  return !!pathname && isWithin(pathname, tab.href);
}
