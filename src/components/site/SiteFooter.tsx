import Link from "next/link";
import { BRAND, copyrightLine } from "@/lib/brand";

const LEGAL_LINKS = [
  { href: "/terminos", label: "Términos y condiciones" },
  { href: "/privacidad", label: "Privacidad" },
  { href: "/cookies", label: "Cookies" },
] as const;

/** Pie público: marca, copyright y enlaces legales. */
export function SiteFooter() {
  return (
    <footer className="w-full border-t border-gray-200/60 mt-16">
      <div className="max-w-5xl mx-auto px-5 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-500">
        <div className="text-center sm:text-left">
          <p className="font-headline font-black text-sm text-gray-800">
            {BRAND.appNameParts[0]} <span className="text-brand-orange">{BRAND.appNameParts[1]}</span>
          </p>
          <p className="mt-1">{copyrightLine()}</p>
          <p className="mt-0.5">Un producto de {BRAND.company}.</p>
          <address className="mt-2 not-italic leading-relaxed">
            <p>
              Titular: {BRAND.legal.holder} · CUIT {BRAND.legal.cuit}
            </p>
            <p>{BRAND.legal.address}</p>
            <p>
              <a
                href={`mailto:${BRAND.contactEmail}`}
                className="font-semibold underline hover:text-gray-800 transition-colors"
              >
                {BRAND.contactEmail}
              </a>
            </p>
          </address>
        </div>
        <nav aria-label="Información legal" className="flex flex-wrap justify-center gap-x-5 gap-y-2">
          {LEGAL_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="font-semibold hover:text-gray-800 transition-colors">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
