"use client";

import { useState, useEffect } from "react";
import { User, Phone, MapPin, Star, ShoppingBag, LogOut, ChevronRight, Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

interface PerfilData {
  nombre: string;
  email: string;
  telefono: string;
  direccion: string;
  puntos: number;
  pedidosTotal: number;
  miembroDesde: string;
}

const PLACEHOLDER: PerfilData = {
  nombre: "—",
  email: "—",
  telefono: "—",
  direccion: "—",
  puntos: 0,
  pedidosTotal: 0,
  miembroDesde: "—",
};

function formatMes(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
}

export default function PerfilPage() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<PerfilData>(PLACEHOLDER);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadPerfil() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setLoading(false);
        return;
      }

      const { data: client } = await supabase
        .from("clients")
        .select("id, name, phone, address, total_points, created_at")
        .eq("user_id", user.id)
        .single();

      const { count } = client
        ? await supabase
            .from("orders")
            .select("id", { count: "exact", head: true })
            .eq("client_id", client.id)
        : { count: 0 };

      setPerfil({
        nombre: client?.name ?? user.email?.split("@")[0] ?? "—",
        email: user.email ?? "—",
        telefono: client?.phone ?? "—",
        direccion: client?.address ?? "—",
        puntos: client?.total_points ?? 0,
        pedidosTotal: count ?? 0,
        miembroDesde: client?.created_at ? formatMes(client.created_at) : "—",
      });
      setLoading(false);
    }

    loadPerfil();
  }, []);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <div className="px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      <div>
        <h2 className="font-headline text-3xl font-black text-gray-800 tracking-tight">Mi Perfil</h2>
        <p className="text-gray-500 text-sm font-medium mt-1">Tu cuenta en Opsyn Dely</p>
      </div>

      {/* Avatar y resumen */}
      <div className={`neumorphic rounded-[2rem] p-4 sm:p-6 flex items-center gap-4 sm:gap-5 transition-opacity ${loading ? "opacity-50" : "opacity-100"}`}>
        <div className="w-20 h-20 rounded-full bg-orange-100 flex items-center justify-center neumorphic-inset shrink-0">
          <User size={36} className="text-brand-orange" />
        </div>
        <div className="min-w-0">
          <p className="font-headline font-black text-xl text-gray-800 truncate">{perfil.nombre}</p>
          <p className="text-sm text-gray-500 truncate">{perfil.email}</p>
          {perfil.miembroDesde !== "—" && (
            <p className="text-xs text-gray-500 mt-1">Miembro desde {perfil.miembroDesde}</p>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="neumorphic rounded-[1.5rem] p-4 text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Star size={16} className="fill-yellow-400 text-yellow-400" />
            <span className="font-headline font-black text-2xl text-gray-800">{perfil.puntos}</span>
          </div>
          <p className="text-xs text-gray-500 font-medium">Puntos acumulados</p>
        </div>
        <div className="neumorphic rounded-[1.5rem] p-4 text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <ShoppingBag size={16} className="text-brand-orange" />
            <span className="font-headline font-black text-2xl text-gray-800">{perfil.pedidosTotal}</span>
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
          <span>{perfil.telefono}</span>
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-600">
          <div className="w-9 h-9 rounded-full neumorphic-inset flex items-center justify-center shrink-0">
            <MapPin size={15} className="text-gray-500" />
          </div>
          <span>{perfil.direccion}</span>
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
