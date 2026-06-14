"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UtensilsCrossed, ReceiptText, Medal, User } from "lucide-react";
import { cn } from "@/lib/cn";

const navItems = [
  { href: "/cliente",          icon: UtensilsCrossed, label: "Inicio",      exact: true  },
  { href: "/cliente/pedidos",  icon: ReceiptText,     label: "Pedidos",     exact: false },
  { href: "/cliente/fidelidad",icon: Medal,           label: "Recompensas", exact: false },
  { href: "/cliente/perfil",   icon: User,            label: "Perfil",      exact: false },
];

export function ClienteBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegación"
      className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 w-[88%] max-w-xs bg-white/85 backdrop-blur-xl rounded-full px-2 py-2 flex justify-around items-center shadow-[0_4px_24px_rgba(163,177,198,0.25)] border border-white/60"
    >
      {navItems.map(({ href, icon: Icon, label, exact }) => {
        const isActive = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-label={label}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center justify-center w-10 h-10 rounded-full transition-all duration-200",
              isActive
                ? "bg-[#6b7c45] text-white shadow-[0_3px_8px_rgba(107,124,69,0.35)] scale-105"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-100",
            )}
          >
            <Icon size={20} />
          </Link>
        );
      })}
    </nav>
  );
}
