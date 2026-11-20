import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { SiteFooter } from "@/components/site/SiteFooter";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Cuenta dada de baja | ${BRAND.appName}`,
  robots: { index: false, follow: false },
};

/** Confirmación tras dar de baja la propia cuenta (cliente o personal). Pública: a esta altura ya no hay sesión. */
export default function CuentaEliminadaPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="w-full max-w-3xl mx-auto px-5 pt-5 flex justify-end">
        <ThemeToggle compact />
      </header>
      <main className="flex-1 w-full max-w-xl mx-auto px-5 py-12 page-fade text-center flex flex-col items-center">
        <CircleCheck size={48} className="text-brand-green" aria-hidden />
        <h1 className="mt-4 font-headline text-3xl font-black text-gray-800">Dimos de baja tu cuenta</h1>
        <p className="mt-3 text-sm text-gray-600 leading-relaxed">
          Dimos de baja tu cuenta y cerramos tu sesión. Ya no vas a recibir emails promocionales ni las promociones por WhatsApp asociadas a tu
          cuenta; para frenar cualquier mensaje promocional en tu número, respondé BAJA por WhatsApp. Conservamos el historial de pedidos por
          motivos contables y legales. Te mandamos un email para avisarte.
        </p>
        <p className="mt-3 text-sm text-gray-600 leading-relaxed">
          Si no lo pediste vos o querés que revisemos algo más, escribinos a{" "}
          <a className="font-bold underline" href={`mailto:${BRAND.contactEmail}?subject=Eliminar%20mis%20datos`}>
            {BRAND.contactEmail}
          </a>{" "}
          o mirá <Link className="font-bold underline" href="/eliminar-datos">cómo eliminar tus datos</Link>.
        </p>
        <Link href="/" className="mt-8 btn-glow text-white font-bold rounded-full px-6 py-3 text-sm">
          Volver al inicio
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
