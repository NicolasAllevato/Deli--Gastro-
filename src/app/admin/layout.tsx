"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Bell, Menu, X } from "lucide-react";
import { SignOutButton } from "@/components/ui/SignOutButton";
import { cn } from "@/lib/cn";
import { SectionTabs } from "@/components/ui/SectionTabs";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { Copyright } from "@/components/Copyright";
import { NAV_SECTIONS, findSection, isTabActive } from "./_nav";
import { CourierShiftAlerts } from "./_components/CourierShifts";
import { ReclamosAlert, useReclamosResumen } from "./_components/ReclamosAlert";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const activeSection = findSection(pathname);
  const reclamos = useReclamosResumen();

  const closeSidebar = () => setSidebarOpen(false);

  return (
    // `fixed inset-0` + `overflow-clip`: el shell siempre ocupa todo el viewport y no se puede
    // desplazar por scrollIntoView/foco (con overflow-hidden sí, y la página quedaba cortada).
    <div className="fixed inset-0 flex bg-background overflow-clip">

      {/* Backdrop mobile */}
      {sidebarOpen && (
        <div
          aria-hidden
          className="fixed inset-0 z-40 bg-gray-900/40 backdrop-blur-sm md:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar — slide-over en mobile, fijo en desktop */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col",
          "w-64 my-3 ml-3 p-4 neumorphic rounded-2xl",
          "transition-transform duration-300 ease-in-out",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
          "md:relative md:inset-auto md:translate-x-0 md:w-52 md:my-3 md:ml-3 md:mr-0 md:flex-shrink-0 md:h-[calc(100%-1.5rem)]",
        )}
      >
        {/* Botón cerrar — solo mobile */}
        <button
          onClick={closeSidebar}
          aria-label="Cerrar menú"
          className="absolute top-4 right-4 p-1.5 rounded-xl text-gray-500 hover:text-brand-orange transition-colors md:hidden"
        >
          <X size={18} />
        </button>

        {/* Brand */}
        <div className="flex items-center gap-3 mb-4 pr-8 md:pr-0 shrink-0">
          <div className="w-9 h-9 rounded-full neumorphic overflow-hidden relative flex-shrink-0">
            <Image alt="Admin" fill sizes="36px" className="object-cover" src="https://picsum.photos/seed/admin-avatar/72/72" />
          </div>
          <div className="min-w-0">
            <p className="text-gray-800 font-bold text-sm truncate">Admin Central</p>
            <p className="text-gray-500 text-[11px]">Maître D&apos;</p>
          </div>
        </div>

        {/* Nav */}
        <nav aria-label="Navegación principal" className="flex-1 min-h-0 overflow-y-auto custom-scrollbar flex flex-col gap-0.5 -mx-1 px-1">
          {NAV_SECTIONS.map((item) => {
            const isActive = activeSection === item;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeSidebar}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200",
                  isActive
                    ? "neumorphic-inset text-brand-orange font-bold"
                    : "text-gray-500 hover:text-gray-800 hover:bg-white/40",
                )}
              >
                <Icon size={17} className="flex-shrink-0" />
                <span>{item.label}</span>
                {item.badge === "reclamos" && reclamos && reclamos.abiertos > 0 && (
                  <span
                    className={cn("ml-auto min-w-5 px-1.5 rounded-full text-[11px] font-bold text-center text-white", reclamos.vencidos > 0 ? "bg-red-600" : "bg-brand-orange")}
                    aria-label={`${reclamos.abiertos} reclamos sin atender`}
                  >
                    {reclamos.abiertos}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer: tema y plan */}
        <div className="mt-2 pt-3 border-t border-gray-200/50 shrink-0">
          <div className="px-2 mb-3">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Apariencia</p>
            <ThemeToggle />
          </div>
          <div className="px-2">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Uso del plan</p>
            <div
              role="progressbar"
              aria-valuenow={66}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Uso del plan: 66%"
              className="h-1.5 w-full neumorphic-inset rounded-full overflow-hidden"
            >
              <div className="h-full bg-brand-orange rounded-full" style={{ width: "66%" }} />
            </div>
            <p className="text-[10px] text-gray-500 mt-1.5">66% utilizado</p>
          </div>
          <Copyright className="mt-3 px-1" />
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-clip">

        {/* TopBar */}
        <header className="flex items-center justify-between px-4 md:px-5 py-3 m-3 mb-2 neumorphic rounded-2xl flex-shrink-0">
          <div className="flex items-center gap-3">
            {/* Hamburger — solo mobile */}
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Abrir menú"
              className="p-2 rounded-xl text-gray-600 hover:text-brand-orange neumorphic neumorphic-hover transition-colors md:hidden"
            >
              <Menu size={20} />
            </button>
            <div>
              <h1 className="font-bold text-lg text-gray-800">Hola, Admin</h1>
              <p className="text-gray-500 text-xs mt-0.5">Centro de comando</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              aria-label="Notificaciones"
              className="relative p-2.5 rounded-xl neumorphic-hover text-gray-500 hover:text-brand-orange transition-colors"
            >
              <Bell size={18} />
              <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-red-500 rounded-full" />
            </button>
            <div className="hidden lg:flex items-center gap-2.5 px-3 py-1.5 rounded-full neumorphic">
              <span className="text-xs font-bold text-gray-600">Gastronomic Excellence</span>
              <div className="w-7 h-7 rounded-full neumorphic-inset flex items-center justify-center text-brand-orange font-black text-xs">
                GE
              </div>
            </div>
            <SignOutButton />
          </div>
        </header>

        <CourierShiftAlerts />
        <ReclamosAlert resumen={reclamos} />

        {/* Content */}
        <div className="flex-1 min-h-0 px-3 pb-8">
          <div className="neumorphic-inset rounded-2xl p-2 md:p-3 h-full overflow-y-auto overflow-x-hidden">
            {activeSection && activeSection.tabs.length > 0 && (
              <SectionTabs
                label={`Secciones de ${activeSection.label}`}
                tabs={activeSection.tabs.map((t) => ({ ...t, active: isTabActive(pathname, t) }))}
              />
            )}
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
