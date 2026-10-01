/**
 * Modo demo: toda la plataforma corre contra una base en memoria, sin
 * Supabase, R2, n8n ni Upstash. Nada se persiste: al reiniciar el servidor
 * (o con "Reiniciar demo") vuelven los datos de ejemplo.
 *
 * Se activa con NEXT_PUBLIC_DEMO_MODE=true (lo setea `npm run demo`).
 * Nunca se activa en producción de Vercel.
 */
export function isDemoMode(): boolean {
  return (
    process.env.NEXT_PUBLIC_DEMO_MODE === "true" &&
    process.env.VERCEL_ENV !== "production"
  );
}

export const DEMO_COOKIE = "demo_session";
