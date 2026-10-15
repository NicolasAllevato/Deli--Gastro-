import Image from "next/image";
import { ImageIcon, Lightbulb, Tag } from "lucide-react";
import { formatMoney } from "@/lib/orders";
import type { Promo } from "@/lib/promos";
import { AddToCartButton } from "./AddToCartButton";
import type { MenuProduct } from "./MenuSection";

interface Props {
  promos: readonly Promo[];
  products: readonly MenuProduct[];
  paused: boolean;
}

/** Promociones y sugerencias del día, cargadas por el local en Configuración → Promos del día. */
export function TodayPicks({ promos, products, paused }: Props) {
  const withProduct = promos.map((promo) => ({
    promo,
    product: promo.productId ? products.find((p) => p.id === promo.productId) : undefined,
  }));
  const promociones = withProduct.filter(({ promo }) => promo.tipo === "promocion");
  const sugerencias = withProduct.filter(({ promo }) => promo.tipo === "sugerencia");
  if (promociones.length === 0 && sugerencias.length === 0) return null;

  return (
    <section aria-labelledby="hoy-title" className="px-5 mb-8 fade-up-3">
      <h3 id="hoy-title" className="font-headline text-xl font-black text-gray-800 mb-4">Hoy en Opsyn Dely</h3>

      {promociones.length > 0 && (
        <ul className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-3 -mx-1 px-1" aria-label="Promociones del día">
          {promociones.map(({ promo, product }) => (
            <li key={promo.id} className="snap-start shrink-0 w-[85%] sm:w-[48%] promo-banner rounded-2xl p-5 text-white flex flex-col gap-3">
              <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest">
                <Tag size={12} aria-hidden /> Promo de hoy
              </span>
              <div>
                <p className="font-headline text-lg font-black leading-tight">{promo.titulo}</p>
                {promo.descripcion && <p className="text-xs text-white/85 mt-1 leading-relaxed">{promo.descripcion}</p>}
              </div>
              {product && (
                <div className="mt-auto flex items-center justify-between gap-2">
                  <span className="text-sm font-black">{product.name} · {formatMoney(product.price)}</span>
                  <AddToCartButton product={{ id: product.id, name: product.name, price: product.price, image_url: product.image_url }} disabled={paused} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {sugerencias.length > 0 && (
        <>
          <p className="mt-3 mb-3 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-gray-500">
            <Lightbulb size={14} className="text-brand-orange" aria-hidden /> Te sugerimos
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4" aria-label="Sugerencias del día">
            {sugerencias.map(({ promo, product }) => (
              <li key={promo.id} className="neumorphic rounded-2xl overflow-hidden card-hover-lift flex flex-col">
                {product && (
                  <div className="relative h-36 neumorphic-inset flex items-center justify-center">
                    {product.image_url ? (
                      <Image src={product.image_url} alt={product.name} fill sizes="(min-width: 640px) 320px, 100vw" className="object-cover" />
                    ) : (
                      <ImageIcon size={28} className="text-gray-300" aria-hidden />
                    )}
                  </div>
                )}
                <div className="p-4 flex flex-col gap-2 flex-1">
                  <p className="font-headline font-black text-gray-800 leading-tight">{promo.titulo}</p>
                  {promo.descripcion && <p className="text-xs text-gray-500 leading-relaxed">{promo.descripcion}</p>}
                  {product && (
                    <div className="mt-auto pt-2 flex items-center justify-between gap-2">
                      <span className="text-sm font-black text-brand-orange">{product.name} · {formatMoney(product.price)}</span>
                      <AddToCartButton product={{ id: product.id, name: product.name, price: product.price, image_url: product.image_url }} disabled={paused} />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
