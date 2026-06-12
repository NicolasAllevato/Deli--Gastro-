"use client";

import { User, Phone, MapPin, Star, ShoppingBag, LogOut, ChevronRight, Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

const mockUsuario = {
  nombre: "María López",
  email: "maria.lopez@email.com",
  telefono: "+54 9 11 1234-5678",
  direccion: "Av. Corrientes 1234, CABA",
  puntos: 280,
  pedidosTotal: 12,
  miembroDesde: "Marzo 2025",
};

export default function PerfilPage() {
  const router = useRouter();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <div className="px-6 py-8 max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="font-headline text-3xl font-black text-gray-800 tracking-tight">Mi Perfil</h2>
        <p className="text-gray-500 text-sm font-medium mt-1">Tu cuenta en Deli-Gastro</p>
      </div>

      {/* Avatar y resumen */}
      <div className="neumorphic rounded-[2rem] p-6 flex items-center gap-5">
        <div className="w-20 h-20 rounded-full bg-orange-100 flex items-center justify-center neumorphic-inset shrink-0">
          <User size={36} className="text-brand-orange" />
        </div>
        <div className="min-w-0">
          <p className="font-headline font-black text-xl text-gray-800 truncate">{mockUsuario.nombre}</p>
          <p className="text-sm text-gray-500 truncate">{mockUsuario.email}</p>
          <p className="text-xs text-gray-500 mt-1">Miembro desde {mockUsuario.miembroDesde}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="neumorphic rounded-[1.5rem] p-4 text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Star size={16} className="fill-yellow-400 text-yellow-400" />
            <span className="font-headline font-black text-2xl text-gray-800">{mockUsuario.puntos}</span>
          </div>
          <p className="text-xs text-gray-500 font-medium">Puntos acumulados</p>
        </div>
        <div className="neumorphic rounded-[1.5rem] p-4 text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <ShoppingBag size={16} className="text-brand-orange" />
            <span className="font-headline font-black text-2xl text-gray-800">{mockUsuario.pedidosTotal}</span>
          </div>
          <p className="text-xs text-gray-500 font-medium">Pedidos realizados</p>
        </div>
      </div>

      {/* Información de contacto */}
      <div className="neumorphic rounded-[2rem] p-5 space-y-4">
        <h3 className="font-headline font-black text-base text-gray-800">Datos de contacto</h3>
        <div className="flex items-center gap-3 text-sm text-gray-600">
          <div className="w-9 h-9 rounded-full neumorphic-inset flex items-center justify-center shrink-0">
            <Phone size={15} className="text-gray-500" />
          </div>
          <span>{mockUsuario.telefono}</span>
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-600">
          <div className="w-9 h-9 rounded-full neumorphic-inset flex items-center justify-center shrink-0">
            <MapPin size={15} className="text-gray-500" />
          </div>
          <span>{mockUsuario.direccion}</span>
        </div>
      </div>

      {/* Acciones */}
      <div className="neumorphic rounded-[2rem] p-2 divide-y divide-gray-200/50">
        <Link
          href="/cliente/pedidos"
          className="flex items-center justify-between px-4 py-4 rounded-[1.5rem] hover:bg-white/40 transition-colors group"
        >
          <div className="flex items-center gap-3">
            <ShoppingBag size={18} className="text-gray-500" />
            <span className="text-sm font-semibold text-gray-700">Mis pedidos</span>
          </div>
          <ChevronRight size={16} className="text-gray-500 group-hover:text-brand-orange transition-colors" />
        </Link>
        <Link
          href="/cliente/fidelidad"
          className="flex items-center justify-between px-4 py-4 rounded-[1.5rem] hover:bg-white/40 transition-colors group"
        >
          <div className="flex items-center gap-3">
            <Star size={18} className="text-gray-500" />
            <span className="text-sm font-semibold text-gray-700">Mis recompensas</span>
          </div>
          <ChevronRight size={16} className="text-gray-500 group-hover:text-brand-orange transition-colors" />
        </Link>
        <button
          type="button"
          className="w-full flex items-center justify-between px-4 py-4 rounded-[1.5rem] hover:bg-white/40 transition-colors group"
          aria-label="Gestionar notificaciones"
        >
          <div className="flex items-center gap-3">
            <Bell size={18} className="text-gray-500" />
            <span className="text-sm font-semibold text-gray-700">Notificaciones</span>
          </div>
          <ChevronRight size={16} className="text-gray-500 group-hover:text-brand-orange transition-colors" />
        </button>
      </div>

      {/* Cerrar sesión */}
      <button
        type="button"
        onClick={handleSignOut}
        className="w-full flex items-center justify-center gap-2 py-4 rounded-[2rem] font-black text-red-500 neumorphic hover:text-red-600 transition-colors text-sm"
        aria-label="Cerrar sesión"
      >
        <LogOut size={18} />
        Cerrar sesión
      </button>
    </div>
  );
}
