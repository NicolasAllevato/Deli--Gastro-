import Link from "next/link";
import { MessageSquareWarning } from "lucide-react";

/** Los reclamos tienen su propia sección (Comunicación → Reclamos): acá queda solo el acceso. */
export function Reclamos() {
  return (
    <section className="neumorphic rounded-2xl p-5 space-y-2" aria-label="Reclamos">
      <h2 className="text-sm font-bold text-gray-800 flex items-center gap-2">
        <MessageSquareWarning size={16} aria-hidden /> Reclamos
      </h2>
      <p className="text-xs text-gray-500">
        El bot registra cada reclamo (con el pedido, la categoría y las fotos del cliente). Se gestionan desde la sección Reclamos.
      </p>
      <Link href="/admin/reclamos" className="inline-block text-sm font-bold text-brand-orange hover:underline">
        Ir a Reclamos
      </Link>
    </section>
  );
}
