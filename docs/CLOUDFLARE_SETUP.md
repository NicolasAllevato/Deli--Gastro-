# Cloudflare — R2 (imágenes) + Workers

Cuenta: **Proyectos OPSYN** (Account ID en `.env.local` → `CLOUDFLARE_ACCOUNT_ID`). Subdominio de Workers: `frankie-400.workers.dev`.
El token `CLOUDFLARE_API_TOKEN` ve 3 cuentas: siempre exportar `CLOUDFLARE_ACCOUNT_ID` antes de `wrangler`.

## Estado (2026-10-12)

| Pieza | Estado |
|---|---|
| Bucket R2 `deli-gastro-productos` | ✅ Público vía r2.dev |
| Worker `uploads` | ✅ `https://uploads.frankie-400.workers.dev` — binding R2 `BUCKET`, secreto `UPLOADS_TOKEN` cargado. Probado: subida real (201), GET público 200, DELETE 200 → 404 |
| `POST /api/upload` | ✅ Usa el Worker `uploads` si existen `UPLOADS_WORKER_URL` + `UPLOADS_WORKER_TOKEN`; si no, cae al camino S3 (`R2_*`); en modo demo devuelve data URL |
| Worker `pedidos-webhook` | ✅ `https://pedidos-webhook.frankie-400.workers.dev`, firma HMAC (`x-webhook-signature`). Sin llamador todavía |
| Worker `finanzas-sync` (cron `0 * * * *`) | ✅ Escribe en `reports_daily`. **Bug arreglado 2026-10-12**: el upsert no pasaba `on_conflict=report_date`, así que solo la 1ra corrida de cada día (UTC) escribía y las demás fallaban con 409 contra `unique(report_date)`. Verificado: la corrida de 04:00 UTC actualizó la fila del día |

> Nota: `finanzas-sync` agrupa por día **UTC** (en Argentina el "día" cambia a las 21:00). Si se quiere el día local, ajustar `todayISODate`.

## Cómo funciona el upload de imágenes

`ProductForm.tsx` → `POST /api/upload` (admin, rate-limit, JPG/PNG/WEBP ≤5MB) →
- **Worker `uploads`** (preferido): `POST /upload` con `Authorization: Bearer <UPLOADS_WORKER_TOKEN>` y el `content-type` real. El Worker revalida tipo, tamaño y *magic bytes*, guarda en `productos/<uuid>.<ext>` y devuelve `{ success, key, url }`. `DELETE /objects/productos/<uuid>.<ext>` borra (mismo bearer).
- **S3 API** (fallback): `@aws-sdk/client-s3` con `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` (aún no generadas; ya no son necesarias).

Código: `workers/uploads/src/{index,validate}.ts`, `src/lib/storage/uploads-worker.ts`. Tests: `workers/uploads` → `npm test`; raíz → `tests/uploads-worker.test.ts`.

## Variables (solo nombres)

`.env.local` (ya completadas) y **Vercel → Environment Variables** (pendiente de cargar):
- `UPLOADS_WORKER_URL`
- `UPLOADS_WORKER_TOKEN`
- `R2_PUBLIC_BASE_URL`, `R2_BUCKET_NAME`, `R2_ENDPOINT` (solo para el fallback S3)
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (opcionales; solo si se quiere el fallback S3)
- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (solo para desplegar; no hacen falta en Vercel)

Secretos de Workers (nunca en `wrangler.toml`):
- `uploads`: `UPLOADS_TOKEN` (= `UPLOADS_WORKER_TOKEN` de Next)
- `pedidos-webhook`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WEBHOOK_SECRET`
- `finanzas-sync`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

## Desplegar / rotar secretos

```bash
cd workers/<worker>
npx wrangler deploy                       # wrangler 4.136.0; `cf deploy` (beta) pide cloudflare.config.ts
npx wrangler secret bulk secrets.json     # JSON generado con Node; borrar el archivo después
```
**Nunca** cargar secretos con un pipe de PowerShell (`"x" | wrangler secret put`): agrega `\r\n` al valor y rompe firmas/bearer.
Rotar el token de uploads: generar uno nuevo, `secret bulk` en `workers/uploads` y actualizar `UPLOADS_WORKER_TOKEN` en `.env.local` y Vercel a la vez.

## Pendiente manual del usuario

1. Cargar `UPLOADS_WORKER_URL` y `UPLOADS_WORKER_TOKEN` en Vercel (copiar desde `.env.local`) y redeployar.
2. (Opcional) Generar R2 API keys en Dashboard → R2 → Manage R2 API Tokens solo si se quiere el fallback S3. La API no permite crearlas.
3. Entregar `WEBHOOK_SECRET` a quien vaya a llamar `pedidos-webhook` (hoy no hay llamador).
4. (Opcional) Dominio propio para el bucket en vez de `r2.dev` (r2.dev tiene rate limit y no cachea en CDN); luego actualizar `PUBLIC_BASE_URL` en `workers/uploads/wrangler.toml` y `R2_PUBLIC_BASE_URL`.
