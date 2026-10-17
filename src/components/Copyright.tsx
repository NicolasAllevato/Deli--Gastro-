import { cn } from "@/lib/cn";

/** Leyenda de derechos de la marca: Opsyn Dely es un producto de Opsyn Soluciones. */
export function Copyright({ className }: { className?: string }) {
  return (
    <p className={cn("text-[10px] leading-snug text-gray-500 text-center", className)}>
      © {new Date().getFullYear()} Opsyn Dely · Opsyn Soluciones. Todos los derechos reservados.
    </p>
  );
}
