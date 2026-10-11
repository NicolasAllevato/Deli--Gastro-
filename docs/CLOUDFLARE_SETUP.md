# Cloudflare — R2 (imágenes) + Workers (pedidos/finanzas)

## Estado actual

| Pieza | Estado |
|---|---|
| Bucket R2 `deli-gastro-productos` | ✅ Creado, acceso público (r2.dev) habilitado |
| Endpoint `POST /api/upload` (Next.js → R2) | ✅ Código listo, requiere R2 API keys (ver abajo) |
| `ProductForm.tsx` (upload real de imagen) | ✅ Migrado, usa `/api/upload` |
| Worker `pedidos-webhook` | ✅ Deployado el 2026-10-11 en `pedidos-webhook.frankie-400.workers.dev`, con secretos cargados y firma HMAC verificada |
| Worker `finanzas-sync` (cron) | ✅ Deployado el 2026-10-11 (`0 * * * *`), con secretos cargados; falta ver su primera corrida horaria |
| Migración `reports_daily` | ✅ Escrita, **no aplicada** (falta proyecto Supabase real) |

## Cuenta Cloudflare

- Cuenta: **Proyectos OPSYN**
- Account ID: en `.env.local` → `CLOUDFLARE_ACCOUNT_ID`
- El `CLOUDFLARE_API_TOKEN` de `.env.local` alcanza para wrangler (whoami, R2 buckets). **No alcanza** para generar R2 API keys S3-compatible — eso es un paso manual (ver siguiente sección), la API de Cloudflare no tiene endpoint para automatizarlo.

## Paso manual pendiente: generar las R2 API keys

1. Dashboard → **R2 Object Storage** → **Manage R2 API Tokens** (no es el mismo lugar que "API Tokens" de cuenta).
2. **Create API Token** → permiso **Object Read & Write** → restringir al bucket `deli-gastro-productos`.
3. Copiar **Access Key ID** y **Secret Access Key** (se muestran una sola vez).
4. Completar en `.env.local`:
   ```
   R2_ACCESS_KEY_ID="..."
   R2_SECRET_ACCESS_KEY="..."
   ```
   (`R2_ENDPOINT`, `R2_BUCKET_NAME` y `R2_PUBLIC_BASE_URL` ya están completados con los valores reales del bucket creado.)
5. En Vercel (producción): agregar las mismas 5 variables `R2_*` en Project Settings → Environment Variables.

## Cómo funciona el upload de imágenes

`ProductForm.tsx` → input de archivo (oculto, trigger por click en el preview) → `POST /api/upload` (protegido con `requireRole("admin")`, rate-limited, valida tipo `jpg/png/webp` y tamaño ≤5MB) → sube a R2 vía `@aws-sdk/client-s3` (R2 es S3-compatible) → devuelve la URL pública (`R2_PUBLIC_BASE_URL/productos/<uuid>.<ext>`) → se guarda como `image_url` del producto.

## Deployar los Workers (cuando Supabase esté conectado)

Ambos Workers están escritos pero **no deployados** porque dependen de un proyecto Supabase real (hoy `.env.local` tiene placeholders). Una vez conectado:

```bash
cd workers/pedidos-webhook
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put WEBHOOK_SECRET   # generar con: openssl rand -hex 32
npx wrangler deploy

cd ../finanzas-sync
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler deploy
```

- **`pedidos-webhook`**: Worker HTTP, capa de baja latencia en el borde para crear/actualizar pedidos directo en Supabase — en paralelo a n8n, no lo reemplaza (n8n sigue haciendo chatbot/reviews). **Requiere autenticación por firma**: cada request debe llevar el header `x-webhook-signature` con el HMAC-SHA256 (hex) del body, firmado con `WEBHOOK_SECRET` — sin eso, cualquiera que encuentre la URL del Worker podría insertar pedidos falsos usando la service_role key. El llamador (n8n u otro sistema) debe firmar el body antes de enviarlo.
- **`finanzas-sync`**: Worker con cron trigger (cada hora), agrega ingresos/egresos del día en `orders` hacia la tabla `reports_daily` (migración `supabase/migrations/002_reports_daily.sql`, RLS: solo el Worker con service_role puede escribir, lectura para usuarios autenticados).

## Variables de entorno nuevas (nombres, nunca valores en archivos trackeados)

`.env.local` / Vercel:
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `R2_ENDPOINT`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_PUBLIC_BASE_URL`

Secrets de cada Worker (vía `wrangler secret put`, nunca en `wrangler.toml`):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
