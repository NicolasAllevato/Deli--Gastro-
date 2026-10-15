import {
  LayoutDashboard, Package, ShoppingBag, MessagesSquare, Hexagon, Settings, type LucideIcon,
} from "lucide-react";

export interface NavTab {
  href: string;
  label: string;
}

export interface NavSection {
  label: string;
  icon: LucideIcon;
  /** Ruta a la que lleva el ítem del panel lateral. */
  href: string;
  /** Pestañas internas; vacío si la sección es una sola página. */
  tabs: ReadonlyArray<NavTab>;
}

export const NAV_SECTIONS: ReadonlyArray<NavSection> = [
  {
    label: "Dashboard", icon: LayoutDashboard, href: "/admin/ejecutivo",
    tabs: [
      { href: "/admin/ejecutivo", label: "Resumen" },
      { href: "/admin/informes", label: "Informes" },
    ],
  },
  {
    label: "Pedidos", icon: Package, href: "/admin/tablero",
    tabs: [
      { href: "/admin/tablero", label: "Tablero" },
      { href: "/admin/pedidos", label: "Historial" },
      { href: "/admin/mapa", label: "Mapa" },
    ],
  },
  {
    label: "Catálogo", icon: ShoppingBag, href: "/admin/productos",
    tabs: [
      { href: "/admin/productos", label: "Productos" },
      { href: "/admin/puntos", label: "Puntos" },
    ],
  },
  {
    label: "Comunicación", icon: MessagesSquare, href: "/admin/conversaciones",
    tabs: [
      { href: "/admin/conversaciones", label: "Conversaciones" },
      { href: "/admin/agente", label: "Agente IA" },
      { href: "/admin/plantillas", label: "Plantillas" },
      { href: "/admin/campanas", label: "Campañas" },
      { href: "/admin/whatsapp", label: "Conexión" },
    ],
  },
  { label: "Zonas de entrega", icon: Hexagon, href: "/admin/zonas", tabs: [] },
  {
    label: "Configuración", icon: Settings, href: "/admin/configuracion",
    tabs: [
      { href: "/admin/configuracion", label: "General" },
      { href: "/admin/legal", label: "Usuarios y documentos" },
    ],
  },
];

const isWithin = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

export function findSection(pathname: string | null): NavSection | undefined {
  if (!pathname) return undefined;
  return NAV_SECTIONS.find((s) =>
    isWithin(pathname, s.href) || s.tabs.some((t) => isWithin(pathname, t.href)),
  );
}

export function isTabActive(pathname: string | null, tab: NavTab): boolean {
  return !!pathname && isWithin(pathname, tab.href);
}
