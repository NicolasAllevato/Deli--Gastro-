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
  { key: "Permissions-Policy",                value: "camera=(), microphone=(), geolocation=(self)" },
  { key: "Strict-Transport-Security",         value: "max-age=63072000; includeSubDomains; preload" },
  // allow-popups: el popup de Facebook Login (Embedded Signup) necesita comunicarse con la página.
  { key: "Cross-Origin-Opener-Policy",        value: "same-origin-allow-popups" },
  { key: "Cross-Origin-Resource-Policy",      value: "same-site" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://va.vercel-scripts.com https://connect.facebook.net`,
      "frame-src https://*.facebook.com",
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob: https://picsum.photos https://lh3.googleusercontent.com https://*.tile.openstreetmap.org${r2Host ? ` https://${r2Host}` : ""}`,
      "font-src 'self'",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://va.vercel-scripts.com https://vitals.vercel-insights.com https://*.facebook.com https://graph.facebook.com",
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
  // Los avisos de `next dev` sobre actualizaciones se limitan a las de seguridad.
  experimental: { agentUpgrade: "security" },
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
      {
        // La APK del repartidor: que el teléfono la reconozca como instalable y la baje, no la abra.
        source: "/descargas/dely-repartidor.apk",
        headers: [
          { key: "Content-Type", value: "application/vnd.android.package-archive" },
          { key: "Content-Disposition", value: "attachment" },
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        // Un solo enlace público: el dominio viejo de Vercel manda las páginas a dely.opsyn.app.
        // /api queda afuera: webhooks (Meta, Mercado Pago) y crons no siguen redirects.
        // Temporal (307) hasta confirmar que todo funciona; después pasar a permanent: true.
        source: "/:path((?!api(?:/|$)).*)",
        has: [{ type: "host", value: "deli-gastro.vercel.app" }],
        destination: "https://dely.opsyn.app/:path",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
