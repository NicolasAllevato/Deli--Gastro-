import { Bike, ChefHat, CircleCheck, MessageCircle } from "lucide-react";

const STEPS = [
  { Icon: MessageCircle, label: "Pedido", detail: "Web o WhatsApp" },
  { Icon: ChefHat, label: "Cocina", detail: "Tablero en vivo" },
  { Icon: Bike, label: "En camino", detail: "Repartidor y mapa" },
  { Icon: CircleCheck, label: "Entregado", detail: "Puntos y reseña" },
] as const;

/** Presentación animada del recorrido de un pedido (CSS puro; respeta reduce-motion). */
export function OrderFlowShowcase() {
  return (
    <div className="relative w-full max-w-3xl mx-auto" aria-label="Recorrido de un pedido">
      <div aria-hidden className="flow-track absolute left-[12.5%] right-[12.5%] top-7 h-1 rounded-full neumorphic-inset overflow-hidden">
        <span className="flow-runner" />
      </div>
      <ol className="relative grid grid-cols-4 gap-2">
        {STEPS.map(({ Icon, label, detail }, i) => (
          <li key={label} className="flex flex-col items-center text-center" style={{ animationDelay: `${0.5 + i * 0.15}s` }}>
            <span className="flow-step w-14 h-14 rounded-2xl neumorphic flex items-center justify-center text-brand-orange" style={{ animationDelay: `${i * 0.9}s` }}>
              <Icon size={22} aria-hidden />
            </span>
            <span className="mt-3 text-xs sm:text-sm font-black text-gray-800">{label}</span>
            <span className="text-[11px] text-gray-500 hidden sm:block">{detail}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
