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

### 4. Plantillas

En `admin/plantillas` → "Crear en Meta" en cada una. Quedan en revisión hasta que Meta las
apruebe. Las campañas no se pueden lanzar hasta que `promocion` esté aprobada.

### 5. Cron de encuestas

Llamar cada 10-15 minutos a `GET /api/cron/surveys` con `Authorization: Bearer <CRON_SECRET>`.
No está en `vercel.json` a propósito: en el plan Hobby de Vercel un cron que corre más de
una vez por día hace fallar el despliegue.

## Cómo está protegido

- El webhook valida la firma HMAC `X-Hub-Signature-256` (falla cerrado si no hay secreto) y
  es idempotente por `wamid` (Meta reintenta).
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
(conviene una columna normalizada e indexada); límite de mensajes por conversación sin tope diario
ni global (costo de IA) y silencioso al excederse; `global_config` es de lectura pública y guarda
`notif_webhook`, `notif_template` y `agente_instrucciones` (mover a `integration_secrets`); rate limit
en memoria si falta Upstash (en producción debe haber Upstash); el webhook no tiene rate limit;
encuestas y campañas con posible doble envío si dos ejecuciones se solapan y campañas largas sin
`maxDuration`; el horario del local solo lo aplica el agente, no el checkout web; informes leen
todas las filas en cada consulta; funciones largas (`buildTools`, `PATCH /api/orders`) y pequeñas
duplicaciones (`guardAdmin`, `firstName`, `resolveLlm`); polling sin pausar con la pestaña oculta;
`downloadMedia` sin validar el host del archivo; mensajes internos de error que llegan al modelo.

## Pendientes conocidos

- Probar contra **Meta y OpenAI reales** (hasta ahora todo se verificó en el demo y con tests
  de las piezas puras): aprobación de plantillas, audios, costos reales de tokens.
- Programar el cron de encuestas (ver arriba).
- Informes programados (resumen diario/semanal) y comparación con el período anterior.
- `orders` guarda el texto de los ítems y no el precio por línea: el ingreso por producto es
  una estimación a precio actual (ver `docs/FLUJO_PEDIDO.md`).
- El checkout web no valida el horario del local (solo el agente lo hace).
- Ubicación compartida de WhatsApp (`type=location`) no soportada.
- Tests E2E (Playwright) de los flujos críticos.
- Secretos en texto plano en `integration_secrets`: evaluar Supabase Vault.
- `handle_new_user` sigue sin versionarse (necesita la definición real del trigger).
- Geocodificación con Nominatim público: sirve para poco volumen; para producción conviene
  Google Geocoding o Mapbox.
