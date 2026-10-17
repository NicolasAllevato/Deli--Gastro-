# Agente de WhatsApp, repartidor, zonas e informes

Guía de lo que se agregó en las fases 0 a 6 y de cómo ponerlo en marcha. Todo funciona
en **modo demo** (`npm run demo`) sin credenciales: el agente usa un modelo de ejemplo,
WhatsApp y Meta se simulan y la base es en memoria.

## Qué hay

| Área | Dónde | Para qué |
|---|---|---|
| Tiempos del pedido | `src/lib/tracking.ts`, `admin/pedidos/[id]` | Cocina, espera de despacho, ruta y total por pedido |
| Repartidor | `admin/tablero`, `repartidor/` | El admin asigna (o el repartidor toma) y marca "Salí con el pedido" / "Entregado" |
| Zonas de entrega | `admin/zonas`, `src/lib/zones.ts` | Círculos o polígonos con tarifa y pedido mínimo; sin zonas se usa radio + costo por km |
| WhatsApp | `admin/whatsapp`, `/api/whatsapp/*` | Conexión con la Cloud API de Meta y webhook firmado |
| Agente de pedidos | `admin/agente`, `src/lib/agent/` | GPT-4o mini con herramientas; entiende audios |
| Conversaciones | `admin/conversaciones` | Ver chats, tomar el control y responder a mano |
| Plantillas y campañas | `admin/plantillas`, `admin/campanas` | Confirmación, seguimiento, encuesta y promociones |
| Informes | `admin/informes`, `src/lib/reports/` | Tablero del período, CSV y analista con IA (solo lectura) |

## Puesta en producción

### 1. Migraciones (en este orden, en el SQL Editor de Supabase)

`005_order_tracking.sql` → `006_delivery_zones.sql` → `007_whatsapp.sql` →
`008_whatsapp_templates_campaigns.sql` → `009_protect_client_columns.sql`.

La 009 es de seguridad: con la política `client_update_own` de la 001 un cliente podía editar sus propios
puntos, nivel y consentimiento de promociones con su sesión; el trigger lo impide (el servidor no se ve afectado).

Sin la 005 fallan los cambios de estado de pedidos en la base real. Ninguna está aplicada
todavía. Todas dejan RLS activo y **sin políticas** en las tablas nuevas: solo las lee y
escribe el service role (las rutas del servidor).

### 2. Variables de entorno

Todas son opcionales: también se cargan desde el panel y quedan en `integration_secrets`
(el entorno tiene prioridad). Ver `.env.example`.

- `OPENAI_API_KEY` (o `Agente IA → Clave de OpenAI`)
- `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`,
  `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` (o `WhatsApp → Credenciales`)
- `CRON_SECRET` para el cron de encuestas

### 3. Conectar WhatsApp

La guía paso a paso está en `admin/whatsapp`. Resumen: app de Meta con el producto WhatsApp,
método de pago en WhatsApp Manager (lo paga el dueño), token permanente de un usuario del
sistema, y en Meta cargar la URL `https://TU-DOMINIO/api/whatsapp/webhook` con el token de
verificación y suscribirse al campo `messages`. Meta solo acepta URLs públicas con HTTPS.
Después, en la sección "Vinculación con Meta": **Registrar número** (PIN de 6 dígitos, una vez),
**Suscribir app** (`POST /{WABA}/subscribed_apps`; sin esto el webhook se verifica pero no llegan
mensajes) y **Revisar vinculación** hasta ver número, cuenta y suscripción en verde. El paso a
paso completo y los errores frecuentes están en el skill `.claude/skills/whatsapp-vinculacion-meta`.
Graph API: `v26.0` (`src/lib/whatsapp/client.ts`).

### 4. Plantillas

En `admin/plantillas` → "Crear en Meta" en cada una. Quedan en revisión hasta que Meta las
apruebe. Las campañas no se pueden lanzar hasta que `promocion` esté aprobada.

### 5. Cron de encuestas (Cloudflare)

Lo dispara el Worker `workers/encuestas-cron` (cron `*/15 * * * *`), que llama a
`GET /api/cron/surveys` con `Authorization: Bearer <CRON_SECRET>`. No usa Vercel Cron a propósito:
en el plan Hobby un cron de más de una vez por día hace fallar el despliegue. Pasos y variables
(`BASE_URL`, `CRON_SECRET`): `workers/encuestas-cron/README.md`.

Reglas del endpoint (`src/lib/whatsapp/surveys.ts`, con tests en `tests/surveys-cron.test.ts`):

- Autenticación: Bearer exacto en tiempo constante; sin `CRON_SECRET` rechaza todo (401).
- Quién recibe: pedidos `Finalizados` entregados hace 30 min a 3 h, sin reseña y con
  `survey_sent_at` vacío, cuyo cliente **le escribió alguna vez al local** (sin conversación no hay
  consentimiento para avisos por WhatsApp). Es una plantilla de utilidad: no depende de
  `wa_marketing_opt_in` (eso es solo para promociones).
- Ventana horaria: solo entre 09:00 y 22:00 de Buenos Aires. Un pedido entregado después de las
  19:00 que no alcanza a ser encuestado antes de las 22:00 queda sin encuesta (vence a las 3 h).
- Idempotencia: el pedido se reclama (`survey_sent_at` condicional) **antes** de enviar; dos
  ejecuciones solapadas no mandan dos veces.
- Reintentos: si el envío falla se libera el pedido y la próxima corrida (15 min) reintenta,
  hasta que vence la ventana de 3 h. Un error de base devuelve 500 y queda en los logs del Worker.

## Cómo está protegido

- El webhook valida la firma HMAC `X-Hub-Signature-256` (falla cerrado si no hay secreto) y
  es idempotente por `wamid` (Meta reintenta; `wamid` es `unique` en la base).
- Tope por conversación: 12 mensajes por minuto y 300 por día (`src/lib/agent/limits.ts`); al cruzar
  el tope se avisa una sola vez y después se calla. El webhook en sí no tiene rate limit por IP a
  propósito: ya exige firma HMAC de Meta y las IP de Meta varían.
- El agente ejecuta como mucho 8 herramientas por turno y 6 pasos del bucle; los errores internos
  de una herramienta no llegan al modelo (solo un mensaje genérico; el detalle va al log).
- El modelo **nunca fija precios ni crea pedidos por su cuenta**: `quote_order` calcula con
  `products` y las zonas, guarda un borrador del lado del servidor y `confirm_order` solo
  crea ese borrador, y solo si el cliente respondió **después** de ver la cotización.
- El horario y la pausa los hace cumplir el servidor, no el prompt.
- Las promociones solo salen a quienes escribieron ALTA por WhatsApp (`clients.wa_marketing_opt_in`),
  al número desde el que lo escribieron; BAJA lo revierte para todas las filas con ese teléfono.
  No hay switch en el perfil web a propósito: el teléfono del perfil no está verificado. Tope de 200 destinatarios por campaña y
  2 campañas por día.
- Las herramientas del analista de informes son de solo lectura y con parámetros acotados.
- Los secretos nunca se devuelven completos por la API (solo `••••1234`).

## Revisión de seguridad y de código

Ya corregido: carreras al cambiar estados (puntos duplicados, doble toma de pedido) con updates
condicionales; `confirm_order` reclama el borrador antes de crear el pedido, valida que el total no
cambió y la cotización vence a los 30 min; informes que fallan en vez de mostrar datos parciales;
tablas de WhatsApp fuera de `api/demo/query`.

Queda por hacer (medio/bajo): `cancel_order` sin paso de confirmación; estado de conversación sin
serializar entre mensajes simultáneos; vinculación cliente-teléfono por escaneo de hasta 2000 filas
(conviene una columna normalizada e indexada); sin tope global de mensajes de IA (hay por conversación: ver arriba); `global_config` es de lectura pública y guarda
`notif_webhook`, `notif_template` y `agente_instrucciones` (mover a `integration_secrets`); rate limit
en memoria si falta Upstash (en producción debe haber Upstash);
campañas con posible doble envío si dos ejecuciones se solapan y campañas largas sin `maxDuration`; el horario del local solo lo aplica el agente, no el checkout web; informes leen
todas las filas en cada consulta; funciones largas (`buildTools`, `PATCH /api/orders`) y pequeñas
duplicaciones (`guardAdmin`, `firstName`, `resolveLlm`); polling sin pausar con la pestaña oculta;
`downloadMedia` sin validar el host del archivo; la encuesta no filtra por SQL los pedidos con reseña
(si hubiera 50 seguidos con reseña en la ventana, los demás esperarían a la próxima corrida).

## Pendientes conocidos

- Probar contra **Meta y OpenAI reales**: ver la checklist de abajo.
- Desplegar `workers/encuestas-cron` (falta `BASE_URL` pública y `CRON_SECRET`): ver README del Worker.
- Informes programados (resumen diario/semanal) y comparación con el período anterior.
- `orders` guarda el texto de los ítems y no el precio por línea: el ingreso por producto es
  una estimación a precio actual (ver `docs/FLUJO_PEDIDO.md`).
- El checkout web no valida el horario del local (solo el agente lo hace).
- Ubicación compartida de WhatsApp (`type=location`) no soportada.
- Secretos en texto plano en `integration_secrets`: evaluar Supabase Vault.
- `handle_new_user` sigue sin versionarse (necesita la definición real del trigger).
- Geocodificación con Nominatim público: sirve para poco volumen; para producción conviene
  Google Geocoding o Mapbox.

## Checklist: lo que no se puede probar sin credenciales reales

Todo esto está cubierto con tests y en modo demo con dobles de prueba (modelo de juguete y
cliente de WhatsApp simulado), pero solo se confirma con claves reales. Hacerlo en este orden;
los pasos con endpoint se prueban con sesión de admin (o desde los botones de `admin/whatsapp`
y `admin/agente`).

| # | Qué cargar | Dónde | Cómo verificar | Respuesta esperada |
|---|---|---|---|---|
| 1 | `OPENAI_API_KEY` (clave de platform.openai.com con facturación) | Entorno / Vercel, o `Agente IA → Clave de OpenAI` | `POST /api/agent/test` con `{"history":[{"role":"user","content":"¿Qué tienen en el menú?"}]}` (o el botón "Probar" de `admin/agente`) | 200 `{"reply":"...","tokens":N}` con N > 0; la respuesta nombra productos y precios que existen en `products`. 400 "Cargá la clave de OpenAI" = falta; 502 = clave inválida o sin saldo |
| 2 | Lo mismo | idem | `POST /api/agent/test` con historial `user: "Quiero 2 de <producto real>"`, `assistant: <su respuesta>`, `user: "Av. Corrientes 1234"` | Resumen con subtotal, envío y total iguales a los de `products` y las zonas. La prueba **no** crea pedido (dry run) |
| 3 | `WHATSAPP_ACCESS_TOKEN` (token permanente de usuario del sistema) y `WHATSAPP_PHONE_NUMBER_ID` | Entorno / Vercel o `WhatsApp → Credenciales` | `POST /api/whatsapp/test` (botón "Probar conexión") | 200 `{"ok":true,"displayPhoneNumber":"+54 ...","verifiedName":"...","quality":"GREEN"}`. 400 = faltan datos; 502 con el mensaje de Meta = token vencido o sin permisos |
| 4 | `WHATSAPP_APP_SECRET` y `WHATSAPP_VERIFY_TOKEN` (lo inventás vos; el mismo en Meta) | idem | En Meta → Webhooks → "Verificar y guardar" con `https://TU-DOMINIO/api/whatsapp/webhook`; suscribir el campo `messages` | Meta acepta. 403 = el token no coincide. Un POST sin firma debe dar 401: `curl -i -X POST https://TU-DOMINIO/api/whatsapp/webhook -d '{}'` |
| 5 | `WHATSAPP_WABA_ID` | idem | `admin/plantillas` → "Crear en Meta" en cada plantilla | Estado `PENDING` y luego `APPROVED` (minutos u horas). `promocion` y `encuesta_satisfaccion` deben estar aprobadas antes de usarlas |
| 6 | Un número de prueba (el tuyo, agregado como destinatario en Meta) | WhatsApp | Escribirle "hola" y "qué hay de menú" al número del negocio | Respuesta del agente en menos de 15 s; el chat aparece en `admin/conversaciones`; el mensaje saliente guarda `tokens` |
| 7 | — | WhatsApp | Mandar un audio corto en español | El agente responde según lo dicho; el entrante `audio` queda con la transcripción en `body` |
| 8 | — | WhatsApp | Pedir, confirmar con "sí" y elegir forma de pago | El pedido aparece en `admin/tablero` con canal WhatsApp y total igual a la cotización; un segundo "sí" no crea otro |
| 9 | — | WhatsApp | Escribir ALTA y luego BAJA | `clients.wa_marketing_opt_in` pasa a `true` y vuelve a `false`; llega la confirmación de cada una |
| 10 | `CRON_SECRET` (cadena larga al azar, la misma en la app y en el Worker) y `BASE_URL` pública | Vercel y Worker | Con un pedido de prueba entregado hace más de 30 min: `curl -H "Authorization: Bearer $CRON_SECRET" https://TU-DOMINIO/api/cron/surveys` | `{"sent":1,"skipped":0,"failed":0,"outsideWindow":false}` y llega la encuesta. Sin el header: 401. Fuera de 9-22 hs: `outsideWindow:true`. Repetir el curl: `sent:0` (no duplica) |
| 11 | — | Cloudflare | `npx wrangler tail` en `workers/encuestas-cron` hasta la próxima marca de 15 min | Línea `[encuestas-cron] ok {...}` |
| 12 | — | OpenAI | Mirar el uso en platform.openai.com tras 20-30 conversaciones | Costo por conversación coherente con GPT-4o mini; si se dispara, bajar `HISTORY_MESSAGES` o `LIMITS` |

Variables de la app (entorno o panel): `OPENAI_API_KEY`, `WHATSAPP_ACCESS_TOKEN`,
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`,
`CRON_SECRET` y `NEXT_PUBLIC_APP_URL` con la URL pública (arma el link de la encuesta). En el
Worker: `BASE_URL` y `CRON_SECRET`.
