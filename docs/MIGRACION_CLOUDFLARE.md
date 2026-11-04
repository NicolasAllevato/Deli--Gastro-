# Migración a Cloudflare y dominio la-gambeta.com

Decidido el 2026-11-04: todo lo del cliente pasa a la cuenta **Opsyn-La gambeta Dely**
(`e7351dd776e005da826ba6f2a5aae4c1`), dueña de la zona `la-gambeta.com` (activa, plan Free).

| Servicio | Hoy | Destino |
|---|---|---|
| App Next.js | Vercel, `dely.opsyn.app` | Worker OpenNext, `app.la-gambeta.com` |
| Bot de WhatsApp | `whatsapp-bot` en Opsyn Dely, vía `dely-proxy` (`bot-dely.opsyn.app`, cuenta Opsyn wallet) | `whatsapp-bot` en la cuenta nueva, `bot.la-gambeta.com` |
| Pasarela Fudo | `fudo-gateway` en Opsyn Dely | `fudo-gateway` en la cuenta nueva (workers.dev, sin dominio propio) |
| Uploads, encuestas-cron, finanzas-sync, pedidos-webhook | Proyectos OPSYN | Fase posterior (no bloquean) |

Supabase no cambia.

## Fase A — Workers a la cuenta nueva

**`fudo-gateway`: HECHO el 2026-11-04.** URL nueva `https://fudo-gateway.opsyn-la-gambeta-dely.workers.dev`, KV `a5d6ac94…`, 5 secretos cargados, crons prendidos y simulacros en 200 (sin pendientes). El Worker viejo de Opsyn Dely quedó con los tres crons en "0"; borrarlo tras el corte.

1. `fudo-gateway`: KV nuevo, `account_id` nuevo, secretos (`FUDO_API_KEY`/`FUDO_API_SECRET` los tiene que
   pasar el usuario: Cloudflare no deja leer los secretos de la cuenta vieja), deploy. Apagar los crons del
   viejo **antes** de prender los del nuevo para no importar dos veces (igual hay `on_conflict`).
2. `whatsapp-bot`: D1 nuevo con export/import de los datos, Durable Object `BUFFER` (estado efímero),
   Workers AI, secretos de Meta/OpenAI (los pasa el usuario), custom domain `bot.la-gambeta.com`.
   `bot-dely.opsyn.app` sigue andando hasta cambiar el webhook en Meta.

## Fase B — App en Cloudflare (OpenNext)
1. `@opennextjs/cloudflare` + `wrangler.jsonc` + `open-next.config.ts`; scripts `preview`/`deploy`.
2. Revisar compatibilidad: Next 16.4.3, `src/proxy.ts`, rutas con `after()`, `next/image`, tamaño del bundle
   (el plan Free de Workers limita a 3 MB comprimido: probablemente haga falta **Workers Paid, US$5/mes**).
3. Quitar `@vercel/analytics` (o reemplazar por Cloudflare Web Analytics) y ajustar la CSP.
4. Copiar las variables de producción de Vercel como secretos/vars del Worker. Cambiar
   `NEXT_PUBLIC_APP_URL=https://app.la-gambeta.com` (se hornea en el build).
5. Deploy a `*.workers.dev`, pasada de humo (login por rol, pedido demo-less de lectura, admin, repartidor PIN).
6. Custom domain `app.la-gambeta.com`.

## Fase C — Corte
- Supabase Auth: Site URL y Redirect URLs con `app.la-gambeta.com`.
- `APP_URL` de `fudo-gateway`, `BASE_URL` de `encuestas-cron`, webhook de Mercado Pago (`PUBLIC_URL`).
- Webhook de Meta a `bot.la-gambeta.com/webhook`.
- APK del repartidor: si apunta a `dely.opsyn.app`, nueva versión o redirect.
- `dely.opsyn.app` → redirect 301 a `app.la-gambeta.com`; Vercel queda pausado una semana antes de borrarlo.

## Lo que necesita el usuario
- `FUDO_API_KEY` / `FUDO_API_SECRET` (usuario `crm-dely@lagambeta`).
- Secretos de `whatsapp-bot` (Meta, OpenAI, etc.).
- Aprobar Workers Paid en la cuenta nueva si el bundle no entra en Free.
