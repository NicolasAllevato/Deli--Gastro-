# Migración a Cloudflare y dominio la-gambeta.com

Decidido el 2026-11-04: todo lo del cliente pasa a la cuenta **Opsyn-La gambeta Dely**
(`e7351dd776e005da826ba6f2a5aae4c1`), dueña de la zona `la-gambeta.com` (activa, plan Free).

| Servicio | Hoy | Destino |
|---|---|---|
| App Next.js | Vercel, `dely.opsyn.app` | Worker OpenNext, `opsyndely.la-gambeta.com` |
| Bot de WhatsApp | `whatsapp-bot` en Opsyn Dely, vía `dely-proxy` (`bot-dely.opsyn.app`, cuenta Opsyn wallet) | `whatsapp-bot` en la cuenta nueva, `bot.la-gambeta.com` |
| Pasarela Fudo | `fudo-gateway` en Opsyn Dely | `fudo-gateway` en la cuenta nueva (workers.dev, sin dominio propio) |
| Uploads, encuestas-cron, finanzas-sync, pedidos-webhook | Proyectos OPSYN | Fase posterior (no bloquean) |

Supabase no cambia.

## Fase A — Workers a la cuenta nueva

**`whatsapp-bot`: HECHO el 2026-11-04.** No usa D1: lee la base por Hyperdrive (nuevo `1a9f0b99…`, rol `deli_bot`) y las credenciales de Meta de `bot_secrets` en Supabase, así que no hubo que copiarlas. Colas `wa-inbound`/`wa-inbound-dlq` creadas, `BOT_INTERNAL_SECRET` nuevo (en `.env.local`; cargarlo igual en la app al migrarla), custom domain `bot.la-gambeta.com` con `/health` ok. Meta sigue apuntando a `bot-dely.opsyn.app` hasta el corte (fase C).

**`fudo-gateway`: HECHO el 2026-11-04.** URL nueva `https://fudo-gateway.opsyn-la-gambeta-dely.workers.dev`, KV `a5d6ac94…`, 5 secretos cargados, crons prendidos y simulacros en 200 (sin pendientes). El Worker viejo de Opsyn Dely quedó con los tres crons en "0"; borrarlo tras el corte.

1. `fudo-gateway`: KV nuevo, `account_id` nuevo, secretos (`FUDO_API_KEY`/`FUDO_API_SECRET` los tiene que
   pasar el usuario: Cloudflare no deja leer los secretos de la cuenta vieja), deploy. Apagar los crons del
   viejo **antes** de prender los del nuevo para no importar dos veces (igual hay `on_conflict`).
2. `whatsapp-bot`: D1 nuevo con export/import de los datos, Durable Object `BUFFER` (estado efímero),
   Workers AI, secretos de Meta/OpenAI (los pasa el usuario), custom domain `bot.la-gambeta.com`.
   `bot-dely.opsyn.app` sigue andando hasta cambiar el webhook en Meta.

## Fase B — App en Cloudflare (OpenNext)

**HECHO el 2026-11-04.** Worker `opsyn-dely` en `https://opsyndely.la-gambeta.com` (y `opsyn-dely.opsyn-la-gambeta-dely.workers.dev`),
bundle 4,76 MB gzip (Workers Paid). Humo OK: páginas públicas 200, guard del proxy (307 a `/login`, APIs 401) y admin
real logueado (`/admin/ejecutivo`, `/admin/tablero`, `/api/orders`, `/api/products` en 200 con datos de Supabase).
Secretos cargados: `SUPABASE_SERVICE_ROLE_KEY`, `UPLOADS_WORKER_TOKEN`, `UPLOADS_WORKER_URL`, `BOT_INTERNAL_SECRET`
(el nuevo, igual al de `whatsapp-bot`) y `CRON_SECRET` nuevo (`CRON_SECRET_CF` en `.env.local`).

**Cómo desplegar** (gotcha): `.env.local` tiene un `CLOUDFLARE_API_TOKEN` de otra cuenta que OpenNext/wrangler cargan
(error 10000) y tokens que no deben empaquetarse. Sacarlo de la carpeta, exportar solo las `NEXT_PUBLIC_*` con
`NEXT_PUBLIC_APP_URL=https://opsyndely.la-gambeta.com`, y correr `env -u CLOUDFLARE_API_TOKEN npm run cf:deploy`.

**Faltan en el Worker** (Vercel no deja descifrar las "sensitive"):
- `UPSTASH_REDIS_REST_URL`/`_TOKEN`: sin ellas el rate limit queda en memoria por instancia (debilita el tope del PIN). Las pasa el usuario o se crea una base nueva.
- `FUDO_GATEWAY_URL` (= `https://fudo-gateway.opsyn-la-gambeta-dely.workers.dev`) y `FUDO_GATEWAY_SECRET`: al final, cuando se active el envío de pedidos a Fudo.
- `OPENAI_API_KEY`, Mercado Pago y Resend: diferidos como en Vercel.

Pasos originales:
1. `@opennextjs/cloudflare` + `wrangler.jsonc` + `open-next.config.ts`; scripts `preview`/`deploy`.
2. Revisar compatibilidad: Next 16.4.3, `src/proxy.ts`, rutas con `after()`, `next/image`, tamaño del bundle
   (el plan Free de Workers limita a 3 MB comprimido: probablemente haga falta **Workers Paid, US$5/mes**).
3. Quitar `@vercel/analytics` (o reemplazar por Cloudflare Web Analytics) y ajustar la CSP.
4. Copiar las variables de producción de Vercel como secretos/vars del Worker. Cambiar
   `NEXT_PUBLIC_APP_URL=https://opsyndely.la-gambeta.com` (se hornea en el build).
5. Deploy a `*.workers.dev`, pasada de humo (login por rol, pedido demo-less de lectura, admin, repartidor PIN).
6. Custom domain `opsyndely.la-gambeta.com`.

## Fase C — Corte
- Supabase Auth: Site URL y Redirect URLs con `opsyndely.la-gambeta.com`.
- `APP_URL` de `fudo-gateway` y de `whatsapp-bot`; `BASE_URL` y `CRON_SECRET` (el nuevo) de `encuestas-cron`; webhook de Mercado Pago (`PUBLIC_URL`).
- Webhook de Meta a `bot.la-gambeta.com/webhook`.
- APK del repartidor: si apunta a `dely.opsyn.app`, nueva versión o redirect.
- `dely.opsyn.app` → redirect 301 a `opsyndely.la-gambeta.com`; Vercel queda pausado una semana antes de borrarlo.

## Lo que necesita el usuario
- `FUDO_API_KEY` / `FUDO_API_SECRET` (usuario `crm-dely@lagambeta`).
- Secretos de `whatsapp-bot` (Meta, OpenAI, etc.).
- Aprobar Workers Paid en la cuenta nueva si el bundle no entra en Free.
