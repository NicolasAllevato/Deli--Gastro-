import Link from "next/link";
import { ShieldAlert, UserCheck, ArrowRight, UtensilsCrossed, Bike } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-5 py-8 sm:p-8 text-center bg-background relative overflow-hidden">

      {/* Subtle background depth — single orb each side */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="float-slow absolute -top-16 -left-16 w-64 h-64 rounded-full bg-brand-orange/5 blur-3xl" />
        <div className="float absolute -bottom-16 -right-16 w-72 h-72 rounded-full bg-brand-green/4 blur-3xl" />
      </div>

      {/* Logo */}
      <div className="fade-up relative z-10 mb-10">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl neumorphic mb-5">
          <UtensilsCrossed size={24} className="text-brand-orange" aria-hidden />
        </div>
        <h1 className="font-headline text-4xl sm:text-5xl font-black text-gray-800 tracking-tight leading-none">
          Deli<span className="text-brand-orange">-</span>Gastro
        </h1>
        <p className="text-gray-500 mt-3 text-sm font-medium max-w-xs mx-auto">
          Selecciona el módulo al que deseas ingresar
        </p>
      </div>

      {/* Portal cards */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-5 relative z-10 mx-auto w-full max-w-xs sm:max-w-none">

        <Link
          href="/admin/ejecutivo"
          className="portal-card neumorphic p-6 rounded-2xl flex flex-col items-center justify-center gap-4 w-full sm:w-56 h-44 sm:h-56 group fade-up-1"
        >
          <div className="w-14 h-14 rounded-xl neumorphic-inset flex items-center justify-center text-brand-orange group-hover:scale-110 transition-transform duration-200">
            <ShieldAlert size={26} />
          </div>
          <div className="text-center">
            <h2 className="text-base font-black text-gray-800 group-hover:text-brand-orange transition-colors duration-200">
              Portal Admin
            </h2>
            <span className="text-xs text-gray-500 font-medium block mt-0.5">Gestión y despacho</span>
          </div>
          <span className="flex items-center gap-1 text-xs font-bold text-brand-orange/50 group-hover:text-brand-orange transition-colors duration-200">
            Ingresar <ArrowRight size={12} />
          </span>
        </Link>

        <Link
          href="/cliente"
          className="portal-card neumorphic p-6 rounded-2xl flex flex-col items-center justify-center gap-4 w-full sm:w-56 h-44 sm:h-56 group fade-up-2"
        >
          <div className="w-14 h-14 rounded-xl neumorphic-inset flex items-center justify-center text-brand-green group-hover:scale-110 transition-transform duration-200">
            <UserCheck size={26} />
          </div>
          <div className="text-center">
            <h2 className="text-base font-black text-gray-800 group-hover:text-brand-green transition-colors duration-200">
              Portal Cliente
            </h2>
            <span className="text-xs text-gray-500 font-medium block mt-0.5">Pedidos y recompensas</span>
          </div>
          <span className="flex items-center gap-1 text-xs font-bold text-brand-green/50 group-hover:text-brand-green transition-colors duration-200">
            Ingresar <ArrowRight size={12} />
          </span>
        </Link>

        <Link
          href="/repartidor"
          className="portal-card neumorphic p-6 rounded-2xl flex flex-col items-center justify-center gap-4 w-full sm:w-56 h-44 sm:h-56 group fade-up-3"
        >
          <div className="w-14 h-14 rounded-xl neumorphic-inset flex items-center justify-center text-blue-500 group-hover:scale-110 transition-transform duration-200">
            <Bike size={26} />
          </div>
          <div className="text-center">
            <h2 className="text-base font-black text-gray-800 group-hover:text-blue-500 transition-colors duration-200">
              Portal Repartidor
            </h2>
            <span className="text-xs text-gray-500 font-medium block mt-0.5">Entregas en ruta</span>
          </div>
          <span className="flex items-center gap-1 text-xs font-bold text-blue-500/50 group-hover:text-blue-500 transition-colors duration-200">
            Ingresar <ArrowRight size={12} />
          </span>
        </Link>
      </div>

      <p className="absolute bottom-5 text-[11px] text-gray-300 font-medium fade-in z-10 tracking-widest">
        v1.0 · Antigravity Design
      </p>
    </div>
  );
}
