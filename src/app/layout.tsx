import type { Metadata } from "next";
import { Manrope, Inter } from "next/font/google";
import "./globals.css";
import { DemoBanner } from "@/components/demo/DemoBanner";
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
  title: "Deli-Gastro Delivery",
  description: "App Web de Control de Delivery y Gestión Operativa",
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
        <DemoBanner />
      </body>
    </html>
  );
}
