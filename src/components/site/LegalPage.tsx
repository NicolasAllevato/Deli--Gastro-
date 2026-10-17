import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { SiteFooter } from "@/components/site/SiteFooter";
import { BRAND } from "@/lib/brand";

export interface LegalSection {
  title: string;
  body: ReactNode;
}

interface Props {
  title: string;
  intro: ReactNode;
  sections: readonly LegalSection[];
}

/** Estructura común de Términos, Privacidad y Cookies. */
export function LegalPage({ title, intro, sections }: Props) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="w-full max-w-3xl mx-auto px-5 pt-5 flex items-center justify-between">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-bold text-gray-600 hover:text-gray-800">
          <ArrowLeft size={16} aria-hidden /> {BRAND.appName}
        </Link>
        <ThemeToggle compact />
      </header>
      <main className="flex-1 w-full max-w-3xl mx-auto px-5 py-10 page-fade">
        <h1 className="font-headline text-3xl sm:text-4xl font-black text-gray-800">{title}</h1>
        <p className="mt-2 text-xs text-gray-500">Última actualización: {BRAND.legalUpdated}</p>
        <div className="mt-6 text-sm text-gray-600 leading-relaxed">{intro}</div>
        <div className="mt-8 flex flex-col gap-4">
          {sections.map((s, i) => (
            <section key={s.title} className="neumorphic rounded-2xl p-5 sm:p-6">
              <h2 className="font-headline text-base font-black text-gray-800">
                {i + 1}. {s.title}
              </h2>
              <div className="mt-2 text-sm text-gray-600 leading-relaxed flex flex-col gap-2">{s.body}</div>
            </section>
          ))}
        </div>
        <p className="mt-8 text-sm text-gray-600">
          Consultas:{" "}
          <a className="font-bold text-gray-800 underline" href={`mailto:${BRAND.contactEmail}`}>
            {BRAND.contactEmail}
          </a>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
