import Image from "next/image";
import Link from "next/link";
import { MessageSquare, ArrowRight, Award, Clock } from "lucide-react";

export default function ClienteDashboardPage() {
  return (
    <div className="min-h-screen pb-4">

      {/* Hero */}
      <section className="relative flex items-center pt-6 pb-10 px-5 min-h-[300px] overflow-visible">
        <div aria-hidden className="pointer-events-none absolute right-0 top-0 w-64 h-64 rounded-full bg-brand-orange/5 blur-3xl" />

        <div className="z-10 max-w-xs fade-up">
          <span className="badge-orange text-[10px] font-black tracking-widest uppercase px-2.5 py-1 rounded-full mb-3 inline-block">
            Especial del Chef
          </span>
          <h2 className="font-headline text-4xl font-black text-gray-800 leading-tight tracking-tight mb-3">
            Pasta <span className="text-brand-orange italic">Primavera</span>
          </h2>
          <p className="text-gray-500 text-sm max-w-[240px] mb-5 leading-relaxed">
            Vegetales frescos, aceite de oliva premium y hierbas silvestres.
          </p>
          <button className="btn-glow text-white font-bold px-6 py-3 rounded-full flex items-center gap-2 text-sm">
            Pedir — $8.500 <ArrowRight size={15} />
          </button>
        </div>

        {/* Imagen hero flotante */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 w-[200px] h-[200px] md:w-[260px] md:h-[260px] hidden sm:block float-slow">
          <div className="w-full h-full rounded-full overflow-hidden neumorphic border-2 border-white/60 relative">
            <Image
              alt="Pasta Primavera"
              fill sizes="260px"
              className="object-cover rounded-full"
              src="https://picsum.photos/seed/pasta-primavera/600/600"
              priority
            />
          </div>
        </div>
      </section>

      <div className="px-5 grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">

        {/* Pedido activo */}
        <div className="fade-up-1">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Pedido Activo</p>
          <div className="neumorphic rounded-2xl p-5 flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-[11px] text-gray-500 font-medium uppercase tracking-widest">Orden #1204</p>
                <h4 className="font-headline font-bold text-base text-gray-800 mt-0.5">En Preparación</h4>
              </div>
              <div className="w-10 h-10 rounded-full neumorphic-inset flex items-center justify-center text-brand-orange">
                <Clock size={18} />
              </div>
            </div>
            <div className="h-2 w-full neumorphic-inset rounded-full overflow-hidden">
              <div className="h-full bg-brand-orange rounded-full" style={{ width: "45%" }} />
            </div>
            <p className="text-xs text-gray-500">Tiempo estimado: <span className="font-bold text-gray-700">15 min</span></p>
          </div>
        </div>

        {/* Fidelidad */}
        <div className="fade-up-2">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Programa de Lealtad</p>
          <div className="neumorphic rounded-2xl p-5 flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <div>
                <span className="badge-yellow text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider inline-block mb-1">Nivel Oro</span>
                <p className="text-sm text-gray-500">Faltan 2 pedidos para tu postre gratis</p>
              </div>
              <Award size={22} className="text-yellow-500 flex-shrink-0" />
            </div>
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                <span>Progreso</span><span className="font-bold text-gray-700">8 / 10</span>
              </div>
              <div className="h-2 w-full neumorphic-inset rounded-full overflow-hidden">
                <div className="h-full bg-brand-orange rounded-full" style={{ width: "80%" }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Chat teaser */}
      <div className="px-5 mb-8 fade-up-3">
        <Link
          href="/cliente/chat"
          className="neumorphic rounded-2xl p-4 flex items-center justify-between group hover:bg-[#6b7c45]/8 transition-colors duration-200"
        >
          <div>
            <p className="font-bold text-sm text-gray-800">Asistente Virtual</p>
            <p className="text-xs text-gray-500 mt-0.5">¿Dudas con tu pedido?</p>
          </div>
          <div className="w-9 h-9 rounded-full bg-brand-orange text-white flex items-center justify-center shadow-[0_4px_12px_rgba(107,124,69,0.3)] group-hover:scale-110 transition-transform duration-200">
            <MessageSquare size={16} />
          </div>
        </Link>
      </div>

      {/* Menú destacado */}
      <section className="px-5 fade-up-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-headline text-xl font-black text-gray-800">Menú Recomendado</h3>
          <Link href="/cliente/pedidos" className="text-xs font-bold text-brand-orange hover:text-orange-600 transition-colors flex items-center gap-1">
            Ver todo <ArrowRight size={12} />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
          {/* Item grande */}
          <div className="md:col-span-7 neumorphic rounded-2xl p-3 group cursor-pointer card-hover-lift">
            <div className="aspect-[16/9] overflow-hidden rounded-xl neumorphic-inset relative">
              <Image
                alt="Power Bowl de Salmón"
                fill sizes="(max-width:768px) 100vw, 55vw"
                className="object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
                src="https://picsum.photos/seed/salmon-bowl/700/440"
              />
            </div>
            <div className="pt-4 px-2 pb-1">
              <div className="flex justify-between items-start">
                <h4 className="font-headline font-bold text-base text-gray-800">Power Bowl de Salmón</h4>
                <span className="font-headline font-black text-brand-orange text-base">$12.450</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">Quinua, salmón marinado y aguacate.</p>
            </div>
          </div>

          {/* Items pequeños */}
          <div className="md:col-span-5 flex flex-col gap-4">
            {[
              { alt: "Volcán de Cacao", seed: "chocolate-cake", name: "Volcán de Cacao",    price: "$4.180" },
              { alt: "Ensalada del Bosque", seed: "forest-salad",   name: "Ensalada del Bosque", price: "$6.290" },
            ].map((item) => (
              <div key={item.seed} className="neumorphic rounded-2xl p-3 flex items-center gap-3 group cursor-pointer card-hover-lift">
                <div className="w-16 h-16 overflow-hidden rounded-xl neumorphic-inset relative flex-shrink-0">
                  <Image
                    alt={item.alt} fill sizes="64px"
                    className="object-cover group-hover:scale-110 transition-transform duration-300 ease-out"
                    src={`https://picsum.photos/seed/${item.seed}/128/128`}
                  />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-gray-800">{item.name}</h4>
                  <p className="text-brand-orange font-black text-sm mt-0.5">{item.price}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
