"use client";

import { useRouter } from "next/navigation";
import { useCart } from "../_components/CartProvider";

interface Props {
  rewardId: string;
  rewardName: string;
}

/** Elige la recompensa y lleva al carrito: el descuento se aplica y los puntos se cobran al confirmar el pedido. */
export function RedeemButton({ rewardId, rewardName }: Props) {
  const router = useRouter();
  const { rewardId: selected, setReward } = useCart();
  const isSelected = selected === rewardId;

  const redeem = () => {
    setReward(rewardId);
    router.push("/cliente/carrito");
  };

  return (
    <button
      type="button"
      onClick={redeem}
      aria-label={`Canjear: ${rewardName}`}
      className="px-3 py-1 rounded-full bg-brand-orange text-white text-xs font-black shadow-[0_4px_12px_rgba(124,58,237,0.3)] hover:scale-105 transition-transform"
    >
      {isSelected ? "En tu carrito" : "Canjear"}
    </button>
  );
}
