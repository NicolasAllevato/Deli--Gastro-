import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BarChart3, Bike, Bot, Gift, ShieldAlert, UserCheck, Zap } from "lucide-react";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { SiteFooter } from "@/components/site/SiteFooter";
import { OrderFlowShowcase } from "@/components/site/OrderFlowShowcase";
import { BRAND } from "@/lib/brand";

const FEATURES = [
  { Icon: Zap, title: "Pedidos en tiempo real", text: "Tablero de cocina, mapa y repartidores sincronizados al instante." },
  { Icon: Bot, title: "WhatsApp con IA", text: "Un agente toma pedidos, entiende audios y avisa cada estado." },
  { Icon: Gift, title: "Fidelización", text: "Puntos, niveles y canjes que hacen volver a tus clientes." },
  { Icon: BarChart3, title: "Tablero ejecutivo", text: "Ventas, puntualidad y satisfacción con un copiloto de análisis." },
] as const;

const PORTALS = [
  { href: "/admin/ejecutivo", title: "Portal Admin", text: "Gestión y despacho", Icon: ShieldAlert, tone: "text-brand-orange", delay: "fade-up-1" },
  { href: "/cliente", title: "Portal Cliente", text: "Pedidos y recompensas", Icon: UserCheck, tone: "text-brand-orange", delay: "fade-up-2" },
  { href: "/repartidor", title: "Portal Repartidor", text: "Entregas en ruta", Icon: Bike, tone: "text-brand-orange", delay: "fade-up-3" },
] as const;

const HEADLINE = ["El", "delivery", "de", "tu", "negocio,", "en", "piloto", "automático."];

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-background relative overflow-hidden">
      {/* Profundidad de fondo */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="float-slow absolute -top-24 -left-24 w-96 h-96 rounded-full bg-brand-orange/10 blur-3xl" />
        <div className="float absolute top-1/3 -right-24 w-96 h-96 rounded-full bg-brand-gold-light/10 blur-3xl" />
      </div>

      {/* Barra superior */}
      <header className="relative z-10 w-full max-w-5xl mx-auto px-5 pt-5 flex items-center justify-between">
        <p className="font-headline font-black text-lg text-gray-800 fade-in">
          {BRAND.appNameParts[0]} <span className="text-brand-orange">{BRAND.appNameParts[1]}</span>
        </p>
        <ThemeToggle compact />
      </header>

      <main className="relative z-10 flex-1 w-full max-w-5xl mx-auto px-5">
        {/* Presentación */}
        <section className="text-center pt-10 sm:pt-14">
          <figure className="fade-up mx-auto mb-8 w-56 sm:w-72">
            <div className="relative aspect-[1099/976] rounded-3xl overflow-hidden logo-glow">
              <Image
                src="/brand/opsyn-dely-logo.jpg"
                alt="Logo de Opsyn Dely: triángulo violeta con un león, un pez y una moto de reparto sobre circuitos"
                fill
                priority
                sizes="(min-width: 640px) 288px, 224px"
                className="object-cover"
              />
            </div>
            <figcaption className="mt-3 text-xs font-semibold text-gray-500">
              Tecnología de {BRAND.company} para gastronomía y delivery
            </figcaption>
          </figure>
          <p className="fade-up inline-flex items-center gap-2 rounded-full neumorphic px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-gray-600">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-green glow-olive" aria-hidden />
            {BRAND.company} · {BRAND.year}
          </p>
          <h1 className="mt-6 font-headline font-black tracking-tight leading-none text-5xl sm:text-7xl">
            <span className="brand-sheen word-rise">{BRAND.appNameParts[0]}</span>{" "}
            <span className="text-gray-800 word-rise" style={{ animationDelay: "0.15s" }}>{BRAND.appNameParts[1]}</span>
          </h1>
          <p className="mt-6 font-headline text-xl sm:text-2xl font-bold text-gray-700 max-w-2xl mx-auto">
            {HEADLINE.map((w, i) => (
              <span key={i} className="word-rise mr-[0.25em]" style={{ animationDelay: `${0.35 + i * 0.07}s` }}>
                {w}
              </span>
            ))}
          </p>
          <p className="mt-4 text-sm sm:text-base text-gray-500 max-w-xl mx-auto fade-up-3">{BRAND.tagline}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3 fade-up-4">
            <a href="#portales" className="btn-glow text-white font-bold rounded-full px-6 py-3 text-sm inline-flex items-center gap-2">
              Ingresar a la plataforma <ArrowRight size={16} aria-hidden />
            </a>
            <a href="#como-funciona" className="neumorphic neumorphic-hover rounded-full px-6 py-3 text-sm font-bold text-gray-700">
              Cómo funciona
            </a>
          </div>
        </section>

        {/* Recorrido animado */}
        <section id="como-funciona" className="mt-20 scroll-mt-8 fade-up-4">
          <h2 className="text-center text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-8">
            De la orden a la puerta, sin perder nada en el camino
          </h2>
          <OrderFlowShowcase />
        </section>

        {/* Funcionalidades */}
        <section aria-label="Funcionalidades" className="mt-20 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map(({ Icon, title, text }, i) => (
            <article key={title} className="neumorphic card-hover-lift rounded-2xl p-5 text-left fade-up" style={{ animationDelay: `${0.9 + i * 0.1}s` }}>
              <span className="w-10 h-10 rounded-xl neumorphic-inset flex items-center justify-center text-brand-orange">
                <Icon size={18} aria-hidden />
              </span>
              <h3 className="mt-4 text-sm font-black text-gray-800">{title}</h3>
              <p className="mt-1 text-xs text-gray-500 leading-relaxed">{text}</p>
            </article>
          ))}
        </section>

        {/* Portales */}
        <section id="portales" className="mt-20 scroll-mt-8 text-center">
          <h2 className="font-headline text-2xl font-black text-gray-800">Elegí tu portal</h2>
          <p className="text-sm text-gray-500 mt-2">Cada rol tiene su espacio, con sus permisos.</p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-5 mx-auto w-full max-w-xs sm:max-w-none">
            {PORTALS.map(({ href, title, text, Icon, tone, delay }) => (
              <Link
                key={href}
                href={href}
                className={`portal-card neumorphic p-6 rounded-2xl flex flex-col items-center justify-center gap-4 w-full sm:w-56 h-44 sm:h-56 group ${delay}`}
              >
                <div className={`w-14 h-14 rounded-xl neumorphic-inset flex items-center justify-center ${tone} group-hover:scale-110 transition-transform duration-200`}>
                  <Icon size={26} aria-hidden />
                </div>
                <div className="text-center">
                  <h3 className="text-base font-black text-gray-800">{title}</h3>
                  <span className="text-xs text-gray-500 font-medium block mt-0.5">{text}</span>
                </div>
                <span className={`flex items-center gap-1 text-xs font-bold ${tone}`}>
                  Ingresar <ArrowRight size={12} aria-hidden />
                </span>
              </Link>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
