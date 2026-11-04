import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Manrope, Inter } from "next/font/google";
import "./globals.css";
import { DemoBanner } from "@/components/demo/DemoBanner";
import { CookieNotice } from "@/components/site/CookieNotice";
import { DEFAULT_THEME, themeInitScript } from "@/lib/theme/themeConfig";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Opsyn Dely",
  description: "Opsyn Dely — delivery inteligente de Opsyn Soluciones: pedidos, WhatsApp con IA y fidelización.",
  applicationName: "Opsyn Dely",
  authors: [{ name: "Opsyn Soluciones" }],
  creator: "Opsyn Soluciones",
  publisher: "Opsyn Soluciones",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" data-theme={DEFAULT_THEME} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${manrope.variable} ${inter.variable} antialiased`}>
        {children}
        <CookieNotice />
        <DemoBanner />
        {/* Solo en Vercel: en Cloudflare (OpenNext) /_vercel/insights no existe. */}
        {process.env.VERCEL ? <Analytics /> : null}
      </body>
    </html>
  );
}
