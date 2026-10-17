import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { BRAND, copyrightLine } from "@/lib/brand";

interface Props {
  code: string;
  title: string;
  message: string;
  /** Acción extra (por ejemplo "Reintentar" en errores del servidor). */
  action?: ReactNode;
}

/** Pantalla de error con la marca: la usan not-found y error. */
export function ErrorScreen({ code, title, message, action }: Props) {
  return (
    <main className="min-h-screen bg-background flex flex-col items-center justify-center px-5 py-10 text-center">
      <figure className="w-40 sm:w-48 fade-up">
        <div className="relative aspect-[1099/976] rounded-3xl overflow-hidden logo-glow">
          <Image src="/brand/opsyn-dely-logo.jpg" alt={`Logo de ${BRAND.appName}`} fill sizes="192px" className="object-cover" />
        </div>
        <figcaption className="mt-3 text-xs font-semibold text-gray-500">{BRAND.appName}</figcaption>
      </figure>
      <p className="mt-8 font-headline text-6xl sm:text-7xl font-black brand-sheen fade-up-1">{code}</p>
      <h1 className="mt-3 font-headline text-2xl font-black text-gray-800 fade-up-2">{title}</h1>
      <p className="mt-2 text-sm text-gray-500 max-w-md fade-up-3">{message}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3 fade-up-4">
        {action}
        <Link href="/" className="btn-glow text-white font-bold rounded-full px-6 py-3 text-sm">
          Volver al inicio
        </Link>
      </div>
      <p className="mt-12 text-[11px] text-gray-500">{copyrightLine()}</p>
    </main>
  );
}
