export const dynamic = "force-dynamic";

import Image from "next/image";
import Link from "next/link";
import { MessageSquare, Award, PauseCircle, Lightbulb } from "lucide-react";
import { requireClientPage } from "@/lib/auth/clientPage";
import { numberConfig, readConfig } from "@/lib/orders-server";
import { formatOrderId, isActiveStatus, REWARDS } from "@/lib/orders";
import { redeemRecommendation } from "@/lib/loyalty/recommendation";
import { AnimatedClock } from "./_components/AnimatedClock";
import { TodayPicks } from "./_components/TodayPicks";
import { PROMO_CONFIG_KEY, parsePromos, promosForToday } from "@/lib/promos";
import { AddToCartButton } from "./_components/AddToCartButton";
import { isPortalVisible } from "@/lib/catalog/visibility";
import { MenuSection, type MenuCategory, type MenuProduct } from "./_components/MenuSection";

const PROGRESS: Record<string, number> = {
  Recibidos: 15,
  "En Preparación": 45,
  "En Camino": 75,
};

export default async function ClienteDashboardPage() {
  const { client, db } = await requireClientPage();

  const [categoriesRes, productsRes, ordersRes, config] = await Promise.all([
    db.from("categories").select("id, name").eq("is_active", true).order("created_at", { ascending: true }),
    db.from("products").select("*").eq("is_active", true).order("created_at", { ascending: true }),
    client
      ? db
          .from("orders")
          .select("id, status, created_at")
          .eq("client_id", client.id)
          .order("created_at", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] }),
    readConfig(db),
  ]);

  const categories = (categoriesRes.data ?? []) as MenuCategory[];
  // Solo lo que el admin marcó "Visible en el portal" (los nuevos de Fudo entran ocultos).
  const products = (productsRes.data ?? []).filter(isPortalVisible).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    price: Number(p.price),
    image_url: p.image_url,
    category_id: p.category_id,
  })) satisfies MenuProduct[];

  const activeOrder = (ordersRes.data ?? []).find((o) => isActiveStatus(o.status));
  const paused = config.modo_pausa === true || config.tienda_activa === false;

  // Destacado: el producto más caro disponible (lo reemplaza el criterio real del negocio más adelante).
  const featured = [...products].sort((a, b) => b.price - a.price)[0];

  const points = client?.total_points ?? 0;
  const nextReward = REWARDS.filter((r) => r.puntosRequeridos > points).sort(
    (a, b) => a.puntosRequeridos - b.puntosRequeridos,
  )[0];
  const rewardTarget = nextReward?.puntosRequeridos ?? REWARDS[0]!.puntosRequeridos;
  const rewardPct = Math.min(100, Math.round((points / rewardTarget) * 100));
  const firstName = client?.name.split(" ")[0];
  const todayPromos = promosForToday(parsePromos(config[PROMO_CONFIG_KEY]));
  const recommendation = redeemRecommendation(points, REWARDS, numberConfig(config, "puntos_por_100", 0.5));

  return (
    <div className="min-h-screen pb-4">
      {paused && (
        <div role="status" className="mx-5 mt-4 flex items-center gap-2 px-4 py-3 rounded-2xl bg-yellow-50 border border-yellow-200 text-yellow-800 text-xs font-bold">
          <PauseCircle size={16} aria-hidden />
          El local pausó los pedidos por un rato. Podés ver el menú, pero no confirmar compras.
        </div>
      )}

      {/* Hero */}
      <section className="relative flex items-center pt-6 pb-10 px-5 min-h-[300px] overflow-visible">
        <div aria-hidden className="pointer-events-none absolute right-0 top-0 w-64 h-64 rounded-full bg-brand-orange/5 blur-3xl" />

        <div className="z-10 max-w-xs fade-up">
          {firstName && <p className="text-sm font-bold text-gray-500 mb-2">Hola, {firstName}</p>}
          <span className="badge-orange text-[10px] font-black tracking-widest uppercase px-2.5 py-1 rounded-full mb-3 inline-block">
            Especial del Chef
          </span>
          <h2 className="font-headline text-4xl font-black text-gray-800 leading-tight tracking-tight mb-3">
            {featured?.name ?? "Menú del día"}
          </h2>
          <p className="text-gray-500 text-sm max-w-[240px] mb-5 leading-relaxed">
            {featured?.description ?? "Pronto vas a ver acá las novedades de la cocina."}
          </p>
          {featured && <AddToCartButton variant="hero" product={featured} disabled={paused} />}
        </div>

        {featured?.image_url && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 w-[200px] h-[200px] md:w-[260px] md:h-[260px] hidden sm:block float-slow">
            <div className="w-full h-full rounded-full overflow-hidden neumorphic border-2 border-white/60 relative">
              <Image alt={featured.name} fill sizes="260px" className="object-cover rounded-full" src={featured.image_url} priority />
            </div>
          </div>
        )}
      </section>

      <div className="px-5 grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
        {/* Pedido activo */}
        <div className="fade-up-1">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Pedido Activo</p>
          {activeOrder ? (
            <Link
              href={`/cliente/pedidos/${activeOrder.id}`}
              className="neumorphic rounded-2xl p-5 flex flex-col gap-4 card-hover-lift"
            >
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-[11px] text-gray-500 font-medium uppercase tracking-widest">Orden {formatOrderId(activeOrder.id)}</p>
                  <h4 className="font-headline font-bold text-base text-gray-800 mt-0.5">{activeOrder.status}</h4>
                </div>
                <div className="w-10 h-10 rounded-full neumorphic-inset flex items-center justify-center text-brand-orange">
                  <AnimatedClock />
                </div>
              </div>
              <div className="h-2 w-full neumorphic-inset rounded-full overflow-hidden">
                <div className="h-full bg-brand-orange rounded-full transition-all" style={{ width: `${PROGRESS[activeOrder.status] ?? 15}%` }} />
              </div>
              <p className="text-xs text-gray-500 font-bold text-brand-orange">Ver seguimiento →</p>
            </Link>
          ) : (
            <div className="neumorphic rounded-2xl p-5 text-sm text-gray-500">
              No tenés pedidos en curso. ¡Elegí algo del menú!
            </div>
          )}
        </div>

        {/* Fidelidad */}
        <div className="fade-up-2">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Programa de Lealtad</p>
          <Link href="/cliente/fidelidad" className="neumorphic rounded-2xl p-5 flex flex-col gap-4 card-hover-lift">
            <div className="flex justify-between items-center">
              <div>
                <span className="badge-yellow text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider inline-block mb-1">
                  Nivel {client?.tier ?? "Bronce"}
                </span>
                <p className="text-sm text-gray-500">
                  {nextReward
                    ? `Faltan ${nextReward.puntosRequeridos - points} pts para "${nextReward.nombre}"`
                    : "¡Ya podés canjear cualquier recompensa!"}
                </p>
              </div>
              <Award size={22} className="text-yellow-500 flex-shrink-0" aria-hidden />
            </div>
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                <span>Progreso</span>
                <span className="font-bold text-gray-700">{points} / {rewardTarget}</span>
              </div>
              <div className="h-2 w-full neumorphic-inset rounded-full overflow-hidden">
                <div className="h-full bg-brand-orange rounded-full" style={{ width: `${rewardPct}%` }} />
              </div>
            </div>
            {recommendation && (
              <p className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold ${recommendation.kind === "ready" ? "badge-green" : "badge-orange"}`}>
                <Lightbulb size={15} className="shrink-0 mt-px" aria-hidden />
                <span>
                  {recommendation.message}
                  {recommendation.kind === "ready" && <span className="block mt-1 font-black underline">Canjear ahora →</span>}
                </span>
              </p>
            )}
          </Link>
        </div>
      </div>

      {/* Chat teaser */}
      <div className="px-5 mb-8 fade-up-3">
        <Link
          href="/cliente/chat"
          className="neumorphic rounded-2xl p-4 flex items-center justify-between group hover:bg-[#7c3aed]/8 transition-colors duration-200"
        >
          <div>
            <p className="font-bold text-sm text-gray-800">Asistente Virtual</p>
            <p className="text-xs text-gray-500 mt-0.5">¿Dudas con tu pedido?</p>
          </div>
          <div className="w-9 h-9 rounded-full bg-brand-orange text-white flex items-center justify-center shadow-[0_4px_12px_rgba(124,58,237,0.3)] group-hover:scale-110 transition-transform duration-200">
            <MessageSquare size={16} aria-hidden />
          </div>
        </Link>
      </div>

      <TodayPicks promos={todayPromos} products={products} paused={paused} />

      <MenuSection categories={categories} products={products} paused={paused} />
    </div>
  );
}
