import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Host público del bucket R2 (imágenes de productos). Se habilita en
// next/image y en la CSP sólo si la variable está definida.
function r2Hostname(): string | null {
  try {
    return process.env.R2_PUBLIC_BASE_URL ? new URL(process.env.R2_PUBLIC_BASE_URL).hostname : null;
  } catch {
    return null;
  }
}
const r2Host = r2Hostname();

const securityHeaders = [
  { key: "X-Frame-Options",                   value: "DENY" },
  { key: "X-Content-Type-Options",            value: "nosniff" },
  { key: "Referrer-Policy",                   value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy",                value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security",         value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Cross-Origin-Opener-Policy",        value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy",      value: "same-site" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob: https://picsum.photos https://lh3.googleusercontent.com https://*.tile.openstreetmap.org${r2Host ? ` https://${r2Host}` : ""}`,
      "font-src 'self'",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // Si el proyecto está en OneDrive/red, definir NEXT_DEV_DIST_DIR en .env.local
  // para redirigir la caché de Turbopack a una carpeta local y evitar lentitud.
  // NEXT_DIST_DIR lo usa `npm run demo:rapido` para no pisar la caché de `next dev`.
  ...(process.env.NEXT_DIST_DIR || process.env.NEXT_DEV_DIST_DIR
    ? { distDir: process.env.NEXT_DIST_DIR || process.env.NEXT_DEV_DIST_DIR }
    : {}),
  // Raíz fija: sin esto Next sube hasta el Escritorio por un package-lock.json ajeno.
  turbopack: { root: process.cwd() },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      ...(r2Host ? [{ protocol: "https" as const, hostname: r2Host }] : []),
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
