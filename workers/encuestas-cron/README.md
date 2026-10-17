# encuestas-cron

Worker de Cloudflare que cada 15 minutos llama a `GET {BASE_URL}/api/cron/surveys` con
`Authorization: Bearer {CRON_SECRET}`. La app decide qué pedidos reciben encuesta (entregados
hace 30 min a 3 h, sin reseña, con conversación de WhatsApp, entre las 9 y las 22 hs de
Buenos Aires) y evita envíos dobles.

## Variables

| Nombre | Qué es |
|---|---|
| `BASE_URL` | URL pública de la app con `https://`, sin barra final. Tiene que ser accesible desde internet (no `localhost`, y sin protección SSO de Vercel). |
| `CRON_SECRET` | El mismo valor que `CRON_SECRET` de la app. Sin él la app responde 401. |

## Deploy

```bash
cd workers/encuestas-cron
npm install
export CLOUDFLARE_ACCOUNT_ID=<id de "Proyectos OPSYN">   # el token ve 3 cuentas
# Cargar los secretos con un archivo JSON (nunca con un pipe de PowerShell: agrega un \n):
#   { "BASE_URL": "https://...", "CRON_SECRET": "..." }
npx wrangler secret bulk secretos.json                    # y borrar el archivo después
npx wrangler deploy
```

Si el Worker aún no existe, `secret bulk` lo crea al vuelo; si da error, hacer `wrangler deploy`
primero (falla en la primera corrida por falta de variables, es esperado) y cargar los secretos.

## Probar

```bash
npm run test         # tests del Worker (URL y encabezado)
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=*/15+*+*+*+*"
npx wrangler tail    # ver las corridas reales
```

Respuesta esperada de la app: `{"sent":N,"skipped":N,"failed":0,"outsideWindow":false}`.
Fuera de 9-22 hs: `outsideWindow: true` y `sent: 0`.

## Resumen diario

Cada corrida también llama a `GET {BASE_URL}/api/cron/daily-summary`. La app envía el resumen del día por mail
y WhatsApp una sola vez, pasada la hora de cierre configurada en Configuración → Notificaciones. Necesita
`RESEND_API_KEY` y el remitente (`notif_email_from` o `RESUMEN_EMAIL_FROM`) en la app para los mails, y la
plantilla `resumen_diario` aprobada por Meta (Plantillas) para WhatsApp.
