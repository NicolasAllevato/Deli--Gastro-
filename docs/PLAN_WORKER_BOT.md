# Plan: bot de WhatsApp en un Worker de Cloudflare con Hyperdrive

## Objetivo
Sacar el bot de Next/Vercel y correrlo en un Worker de Cloudflare (cuenta `53d56863…`):
- **Respuesta más rápida:** sin cold start de la función de Vercel; Meta recibe el 200 en milisegundos.
- **Base más rápida:** conexión Postgres directa a Supabase por **Hyperdrive** (pool de conexiones + caché de
  lecturas), en vez de la API REST de `supabase-js`.
- **Dominio propio:** `bot.<dominio>` → Worker (webhook de Meta); `<dominio>` / `app.<dominio>` → Vercel (panel y web).

## Situación actual (relevada)
| Pieza | Dónde | Consultas a la base |
|---|---|---|
| Webhook (firma, parseo, `after()`) | `src/app/api/whatsapp/webhook/route.ts` | — |
| Entrada: dedupe por `wamid`, conversación, cliente | `src/lib/whatsapp/inbound.ts`, `pipeline.ts`, `clients.ts` | 13 |
| Agente: bucle, prompt, herramientas, límites, horario | `src/lib/agent/*` | 18 |
| Cotización y creación de pedidos | `src/lib/orders-create.ts`, `orders-server.ts`, `zones-server.ts` | 23 |
| Cobro Mercado Pago | `src/lib/payments/intents.ts` | 16 |
| Cliente Graph API | `src/lib/whatsapp/client.ts` | — (ya es `fetch` puro: sirve tal cual) |

Lo puro (sin base) ya está separado y testeado: `signature`, `payload`, `phone`, `keywords`, `hours`,
`limits`, `prompt`, `zones`, `client`. Eso se reusa sin cambios.
Los Workers viejos `workers/chatbot` y `workers/dispatcher` (reemplazo de n8n, Anthropic) quedan fuera: se borran al final.

## Arquitectura
```
Meta ──POST──▶ bot.<dominio>  (Worker "whatsapp-bot")
                 │ 1. verifica firma HMAC (App Secret desde la base, caché 60 s en memoria)
                 │ 2. responde 200 al instante
                 │ 3. ctx.waitUntil → encola el evento en una Queue
                 ▼
             Queue "wa-inbound" ──▶ consumidor (mismo Worker)
                 │ dedupe wamid → conversación → agente (Workers AI) → herramientas → envío Graph API
                 ▼
             Hyperdrive ──▶ Postgres de Supabase (proyecto "Delivery", solo tablas de Deli-Gastro)

Panel Next (Vercel) sigue usando supabase-js; comparte la misma base. Realtime del tablero no cambia.
```
**Por qué una Queue y no solo `waitUntil`:** `waitUntil` tiene un tope de 30 s después de responder y no
reintenta; una llamada al modelo con herramientas puede pasar eso. La Queue da reintentos, procesa en orden por
lotes y aísla errores (cola de mensajes fallidos). Costo: incluida en Workers Paid (USD 5/mes); sin plan pago
se usa `waitUntil` y se acepta el límite.

## Modelos: Workers AI (sin OpenAI)
Decisión: los dos bots y la transcripción corren en **Workers AI** (binding `AI`), dentro de Cloudflare.
| Uso | Modelo | Por qué |
|---|---|---|
| Clasificador | `@cf/mistralai/mistral-small-3.1-24b-instruct` con `response_format` JSON schema | 24/24 en el benchmark, ~1 s |
| Clasificador (alternativa barata) | `@cf/ibm-granite/granite-4.0-h-micro` | 23/24, 20× más barato |
| Respondedor (consultas y pedidos) | `@cf/qwen/qwen3-30b-a3b-fp8` con *function calling* | 6/6 en herramientas, barato (USD 0,05 / 0,34 por M) |
| Respondedor (respaldo si falla) | `@cf/openai/gpt-oss-120b` | 5/6, el más sólido después de Qwen |
| Audios | `@cf/openai/whisper-large-v3-turbo` | Transcripción en el mismo Worker |

**Benchmark (2026-10-17, cuenta 53d56863):** 24 mensajes etiquetados para el clasificador y 6 escenarios con
herramientas para el respondedor. Descartados: `llama-3.1-8b` (no acepta JSON schema), `glm-4.7-flash` y
`gemma-4` (no devolvieron el JSON a tiempo), `llama-3.3-70b` y `llama-4-scout` (3/6 con herramientas: cotizaban
sin dirección o confirmaban sin cotización). Muestra chica: ampliar a ~60 casos en la fase 4.
**Regla que confirma el benchmark:** varios modelos llamaron `confirm_order` sin cotización previa; el servidor
debe seguir rechazándolo (solo confirma un borrador cotizado y vigente), nunca confiar en el modelo.

Los nombres de modelo van en una constante (`models.ts`) para cambiarlos sin tocar la lógica; antes de la fase 4
se valida con el set de mensajes de ejemplo que la precisión del clasificador sea ≥ 90 % y que el 70B use bien
las herramientas. Si un modelo no rinde, se cambia por otro del catálogo de Workers AI.
`OPENAI_API_KEY` deja de ser necesaria para el bot (el analista de informes del panel sigue aparte).

## Dos bots en uno: clasificador + respondedor
Cada mensaje pasa por dos etapas. El camino es corto y cada etapa tiene un prompt chico y fácil de ajustar.

**1. Clasificador** (Workers AI, salida JSON estricta, sin herramientas):
```json
{ "intent": "pedido_nuevo", "confidence": 0.93, "datos": { "items": ["2 muzza"], "direccion": null } }
```
| Intención | Qué cubre |
|---|---|
| `consulta_local` | horario, dirección, zonas y costo de envío, medios de pago, si está abierto |
| `consulta_menu` | qué hay, precios, ingredientes, promos del día |
| `pedido_nuevo` | quiere pedir o agrega/cambia productos de un pedido en armado |
| `pedido_datos` | responde un dato pendiente (dirección, nombre, pago, aclaración) |
| `pedido_confirmar` | «sí», «dale», «confirmo» sobre una cotización mostrada |
| `pedido_estado` | ¿dónde está mi pedido?, demoras |
| `pedido_cancelar` | quiere cancelar |
| `suscripcion` | ALTA / BAJA de promociones (hoy ya se resuelven por palabra clave, sin IA) |
| `humano` | queja, pide hablar con alguien, temas fuera de alcance |
| `saludo` / `otro` | saludo, agradecimiento, mensaje sin sentido |

Antes del clasificador corren las reglas fijas que ya existen (sin costo de IA): ALTA/BAJA, conversación en
manos de un humano, local cerrado o en pausa, topes por conversación. Si `confidence < 0.6` se pregunta
amablemente qué necesita en vez de adivinar.

**2. Respondedor** según la intención, con solo las herramientas que esa intención necesita:
| Intención | Respondedor | Herramientas |
|---|---|---|
| `consulta_local`, `consulta_menu`, `saludo` | Informativo (respuesta corta) | `get_business_info`, `get_menu` (solo lectura) |
| `pedido_*` | Tomador de pedidos (máquina de estados, ver abajo) | `get_menu`, `quote_order`, `confirm_order`, `cancel_order` |
| `pedido_estado` | Seguimiento | `order_status` |
| `humano` | Traspaso | `handoff_to_human` (avisa en `/admin/conversaciones`) |

Ventajas: menos tokens por mensaje (el informativo no carga el catálogo de herramientas de pedidos), menos
errores (el modelo de consultas no puede crear pedidos) y cada parte se prueba por separado con casos de ejemplo.

### Tomador de pedidos alineado con el ingreso de pedidos de la app
El borrador vive en la base (`order_drafts`, como hoy) y avanza por estados; el bot pide **solo el siguiente
dato que falta**, los mismos que exige `createOrder` en `src/lib/orders-create.ts` para un pedido web:

| Paso | Dato | Validación (la misma que la web) |
|---|---|---|
| 1 | Productos y cantidades | Existen en `products`, activos, con stock/disponibles |
| 2 | Retiro o envío | Si es envío, sigue el paso 3 |
| 3 | Dirección | Geocodificada; dentro de una zona (`zones.ts`), pedido mínimo de la zona |
| 4 | Nombre | Del cliente vinculado por teléfono o lo pide |
| 5 | Forma de pago | Las habilitadas en el local (efectivo, transferencia, Mercado Pago) |
| 6 | Aclaraciones | Opcional (sin cebolla, timbre, etc.) |
| 7 | Cotización | `quote_order`: subtotal, envío, descuentos de puntos, total. Vence a los 30 min |
| 8 | Confirmación | Solo un «sí» posterior a la cotización; `confirm_order` crea el pedido una única vez |

Después de crear el pedido, todo sale por el mismo circuito que un pedido web:
- **Confirmación**: plantilla `confirmacion_pedido` (o texto si está dentro de las 24 h) con número y total.
- **Mercado Pago**: si eligió MP, link de pago de `payments/intents.ts`.
- **Seguimiento**: cada cambio de estado en el tablero (En cocina → En camino → Entregado) dispara la plantilla de
  seguimiento por `notify.ts`; el Worker no la duplica, la sigue enviando el mismo módulo.
- **Encuesta**: el cron `encuestas-cron` a los 30 min de entregado.

## Acceso a la base
- **Hyperdrive** apuntando al *connection pooler* de Supabase (puerto 6543, modo transacción) con un rol propio
  `deli_bot` (no `postgres`): `GRANT` solo sobre las tablas de Deli-Gastro que usa el bot. Así el Worker no
  puede tocar el otro sistema que comparte el proyecto.
- Driver: `postgres` (postgres.js), soportado por Hyperdrive con `nodejs_compat`.
- **Capa de repositorio** (`workers/whatsapp-bot/src/repo/*.ts`): una interfaz por área (conversaciones,
  clientes, productos/zonas, pedidos, pagos, ajustes) con las consultas en SQL parametrizado. El agente y la
  entrada dependen de la interfaz, no del driver → los tests usan un repo en memoria.
- Operaciones con carrera (reclamar borrador, dedupe `wamid`, `survey_sent_at`) pasan a SQL atómico
  (`INSERT … ON CONFLICT`, `UPDATE … WHERE … RETURNING`), igual de seguras que hoy.
- Caché de lecturas de Hyperdrive para menú, zonas y ajustes (cambian poco); desactivada para
  conversaciones y pedidos.

## Código compartido
El Worker importa los módulos puros de `src/lib/**` con rutas relativas (wrangler los empaqueta con esbuild).
Regla: un módulo que use el Worker **no** puede importar `next/*` ni `@/utils/supabase/*`. Se agrega un test de
dependencias que lo verifica. Donde hoy hay lógica mezclada con `supabase-js` (`tools.ts`, `orders-create.ts`),
se separa la parte pura (cálculo de totales, validación) de la de base.

## Secretos y configuración
| Qué | Dónde |
|---|---|
| Cadena de conexión de Postgres | Hyperdrive (`wrangler hyperdrive create`), nunca en el repo |
| Workers AI | Binding `AI` (sin clave) |
| Token de WhatsApp, App Secret, verify token | Se siguen leyendo de `integration_secrets` (los carga el panel / Embedded Signup); caché 60 s |
| Mercado Pago | Igual que hoy, desde `integration_secrets` |

## Estado (2026-10-19)
| Fase | Estado |
|---|---|
| 1. Infra | Hecha: rol `deli_bot` (015), vista `bot_secrets` (016), Hyperdrive `deli-gastro-db`, Worker desplegado. |
| 2. Repositorio | Hecha en forma acotada: `repo/inbound.ts` y `repo/bot.ts` (SQL) con repos en memoria en los tests. |
| 3. Entrada | Hecha: POST firmado, dedupe por `wamid`, traspaso a humano, estados; apilador (Durable Object, 4 s / 12 s / 5 mensajes). |
| 4. Bots | Hecha: clasificador + respondedor con herramientas por intención, guardrails de entrada y salida, audios con Whisper, ALTA/BAJA, límites. Los pedidos se derivan a la web hasta la fase 5. |
| 5. Pedidos y pagos | Endpoints internos de la app hechos (PR #18/#19) y lado del Worker hecho (cliente firmado, herramientas, plantillas, compuertas; todo detrás del flag `bot_orders_enabled`, apagado por defecto). Falta activarlo: ver «Estado del lado del Worker». |
| 6. Corte | Pendiente: Meta sigue apuntando al webhook de Next. Demo: `bot-dely.opsyn.app` (reenvío desde la cuenta Opsyn wallet). |

## Fases
1. **Infra** (sin tocar el bot actual): rol `deli_bot` con permisos mínimos (migración 015), Hyperdrive,
   Worker vacío con `GET` de verificación y ruta `/health` que hace `select 1`. Medir latencia de la base.
2. **Repositorio + tests**: interfaz y repo SQL de cada área; repo en memoria; tests de contrato que corren
   contra los dos (el SQL contra una base local o una branch de Supabase).
3. **Entrada y envío**: firma, parseo, dedupe, conversación, palabras clave (ALTA/BAJA), traspaso a humano,
   estados de entrega. Webhook responde 200 y encola.
4. **Clasificador + respondedores**: clasificador con JSON estricto y set de ~60 mensajes de ejemplo etiquetados
   (test de precisión ≥ 90 %); respondedor informativo, tomador de pedidos por estados, seguimiento y traspaso;
   límites por conversación; audios (descarga + transcripción, el texto entra al clasificador).
5. **Pedidos y pagos**: creación del pedido desde el borrador y link de Mercado Pago, con las mismas
   validaciones (total sin cambios, cotización vigente 30 min, una sola confirmación).
6. **Corte**: dominio propio → `bot.<dominio>`; en Meta se cambia la URL del webhook. Se deja el webhook de
   Next respondiendo 200 sin procesar durante una semana (por si Meta reintenta a la URL vieja) y después se borra
   junto con `workers/chatbot` y `workers/dispatcher`.

Cada fase termina con tests en verde y se puede desplegar sola; hasta la fase 6 el bot real sigue en Next.

## Fase 5: endpoints internos del tomador de pedidos
El Worker **no escribe pedidos por SQL**: llama a endpoints internos firmados de la app, que usan
`src/lib/agent/order-actions.ts` (las mismas reglas que el agente de Next y la web). Código en
`src/lib/bot-internal/` (firma, esquemas, handlers testeables) y `src/app/api/internal/bot/{quote,confirm,cancel,status}/route.ts` (finos).

### Decisiones de la v1
Pago en **efectivo** (el pedido se crea al confirmar) o con **Mercado Pago** (se crea al acreditarse el pago); **sin canje de puntos**; el bot solo cancela pedidos en `Recibidos` y con confirmación explícita del cliente.

### Autenticación
`POST` con headers `x-bot-timestamp` (segundos Unix) y `x-bot-signature` = HMAC-SHA256 hex, con `BOT_INTERNAL_SECRET`, de
`${timestamp}.${METHOD}.${path}.${sha256hex(cuerpo)}` (`path` sin query, p. ej. `/api/internal/bot/quote`).
Ventana de ±60 s, comparación en tiempo constante, cuerpo máximo 16 KB. La firma se verifica **antes** de parsear el cuerpo.
Respuestas: 401 firma inválida/vencida, 413 cuerpo grande, 429 rate limit (por IP y por conversación), 503 sin secreto.

### Variables de entorno (Vercel; nunca en el repo)
| Variable | Uso |
|---|---|
| `BOT_INTERNAL_SECRET` | Secreto compartido con el Worker. **Si falta, el endpoint responde 503 en todo** |
| `BOT_INTERNAL_SECRET_PREV` | Opcional. Secreto anterior aceptado durante una rotación |

Rotación: poner el nuevo en `BOT_INTERNAL_SECRET` y el viejo en `BOT_INTERNAL_SECRET_PREV`, actualizar el Worker, y después borrar `_PREV`.

### Claves de `global_config` (se leen en el servidor en cada llamada, sin caché)
| Clave | Default | Efecto |
|---|---|---|
| `bot_orders_enabled` | `false` | Apagado: `quote` y `confirm` responden 403 `orders_disabled`. **No** afecta a `status` ni `cancel` |
| `bot_orders_allowlist` | ausente | Ver reglas abajo. Aplica a `quote`, `confirm`, `status` y `cancel` (403 `orders_disabled`) |
| `bot_max_units` | 12 | Unidades totales por pedido |
| `bot_max_total` | 80000 | Importe máximo por pedido (ARS, subtotal + envío). Default conservador para el piloto: se sube desde `global_config` |
| `bot_max_active_orders` | 1 | Pedidos en curso del cliente (activos recientes + pago pendiente vigente) |
| `bot_active_window_hours` | 3 | Un pedido activo más viejo que esto no cuenta (un «En Camino» olvidado no bloquea al cliente para siempre) |
| `bot_orders_fudo_enabled` | ausente (= apagado) | Solo con `true` los pedidos del canal `whatsapp` crean la venta en Fudo (`src/lib/data/fudo-sales.ts`, `claimForSale`). Ausente o cualquier otro valor: el pedido del bot queda solo en la app (piloto de pruebas sin ventas reales en Fudo). El resto de los pedidos no cambia |

Pasar un tope devuelve 422 `limit_exceeded` con mensaje en español para derivar a una persona. En `quote` el tope se evalúa
**antes** de guardar el borrador (uno fuera de tope nunca se persiste) y en `confirm` sobre el borrador que realmente se reclama, antes del claim.

**Allowlist (fail-closed):** valor ausente, `null`, `[]` o texto vacío = sin restricción. `"*"` (texto o dentro de la lista) = todos, explícito.
Cualquier otro valor definido que no dé ningún teléfono (objeto, número, typo, entradas sin dígitos) = **nadie** pasa. Los teléfonos se
comparan por los últimos 10 dígitos.

**Gates por operación:** `quote` y `confirm` exigen `bot_orders_enabled` + allowlist. `status` y `cancel` siguen solo la allowlist: con los pedidos
apagados el cliente igual puede consultar y cancelar un pedido en curso.

**`human_takeover`:** si la conversación está tomada por una persona, `quote` y `confirm` responden 409 `human_takeover` (`status` y `cancel` quedan libres).
**Pedidos activos:** si la consulta falla responde 503 `unavailable` (no cuenta 0). Con `client_id` nulo se cuenta 0: la conversación nunca confirmó
un pedido y el cliente recién se crea al confirmar.

**`confirm` con link perdido:** si no hay borrador y el cliente tiene un pago pendiente vigente de WhatsApp, `confirm` devuelve 200
`{awaiting_payment:true, payment_url, total, replayed:true}` en vez de chocar con el tope de pedidos activos. El replay por `Idempotency-Key` se
resuelve antes del chequeo de ≤ 10 min del wamid (la pertenencia y que sea entrante se verifican siempre).

**Formato de la allowlist:** cargar los teléfonos como **array** (`["5491155550101", "5491122223333"]`) o como texto separado por comas **sin espacios**.
Un solo string con espacios dentro de un número (p. ej. `"+54 9 11 5555-0101"` entre otros) no coincide con nadie y, por ser fail-closed, bloquea a todos.

**Replay de idempotencia:** la marca guarda `at` y se descarta pasados 30 minutos. El replay **no respeta `bot_orders_enabled` a propósito**
(es la respuesta ya calculada de un reintento); el link de pago igual vence solo a los 30 minutos y se valida contra la intención vigente.

**Errores de lectura:** si falla la lectura de `global_config` o de `wa_messages`, toda operación responde 503 `unavailable` (no se trata como vacío).
Si no se puede guardar el borrador, `quote` responde 503 `unavailable` en vez de ofrecer una cotización que no se podría confirmar.

### Reglas para el Worker
- Firmar con un `x-bot-timestamp` **nuevo en cada reintento** (la ventana es de 60 s).
- 403 y 422 **no son reintentables**; 400/401 tampoco. 409 `claim_lost` **sí** es reintentable (con la misma `Idempotency-Key`); 429 y 5xx también.
- 409 `human_takeover`, `not_confirmed`, `expired`, `no_draft`: se resuelven en la conversación, no reintentando.

### Antes del piloto
- `BOT_INTERNAL_SECRET` (≥ 32 caracteres) **idéntico** en Vercel (Production **y** Preview) y en el Worker, sin BOM ni espacios.
- Cargar explícitos en `global_config`: `bot_orders_enabled = true`, `bot_orders_allowlist = ["<teléfono del dueño>"]`, `bot_max_units`, `bot_max_total`, `bot_max_active_orders`. **Dejar `bot_orders_fudo_enabled` ausente** mientras se prueba (los pedidos del bot no van a Fudo).
- Plantillas de Meta aprobadas (confirmación, seguimiento, link de pago).
- Monitorear `payment_intents` con `refund_error` o `approved` sin `order_id`.

### Diferido
Anular la preferencia de Mercado Pago al cancelar (depende del gateway), tabla de idempotencia propia, rate limit distribuido y pago de una intención vencida. Límite conocido: si tras un fallo de `confirm` no se puede restaurar el borrador
(`restoreDraft` condicionado por `updated_at` falla dos veces), se loguea y el cliente debe volver a cotizar; no hay update incondicional de último recurso.

### Estado del lado del Worker (PR 3)
Hecho en `workers/whatsapp-bot/src`:
- `orders/client.ts`: cliente firmado (Web Crypto, misma firma que `signature.ts`, con test de paridad), timestamp nuevo por intento, timeout 8 s, `Idempotency-Key` = wamid en confirm/cancel. `claim_lost` reintenta una vez; 429/5xx/red/timeout hasta 2 reintentos con backoff; 400/401/403/422/409 y `503 not_configured` no se reintentan.
- `orders/flow.ts`: plantillas fijas (resumen, link de pago, pregunta de cancelar, errores por código) y compuertas. `bot/tools.ts`: `quote_order`, `confirm_order`, `cancel_order` y `order_status` (por la app) con esquemas estrictos; `get_menu` expone el `id` solo con el flag encendido.
- `bot/turn.ts`: con `bot_orders_enabled` en `global_config` (mismo flag que el servidor) y `BOT_INTERNAL_SECRET` cargado, las intenciones de pedido ya no se derivan a la web. Con el flag apagado o sin secreto el camino es el de siempre (`orderReply`; sin secreto y con flag encendido, «no disponible, hacelo desde la web»).
- El resumen lo envía el Worker desde los datos del servidor (el texto del modelo se descarta). El «SÍ» literal justo después del resumen confirma sin pasar por el clasificador. `confirm_order` exige: sin `quote_order` en el turno, último mensaje del cliente = afirmación literal corta (sí, dale, ok, listo, confirmo, de acuerdo; no audios, no preguntas), el último mensaje del bot es el resumen y `Efectivo` o `Mercado Pago` (`SÍ EFECTIVO` → efectivo; `SÍ` solo o `SÍ MERCADO PAGO` → Mercado Pago). Cancelar: el bot pregunta con plantilla y solo un SÍ posterior cancela. El link de pago solo se envía si es https de Mercado Pago.
- Logs: `op`, `status`, `code` (sin datos personales).

Falta (no se hizo ni se despliega desde el código):
1. `BOT_INTERNAL_SECRET` en Vercel (Production y Preview) y en el Worker (`wrangler secret put`), idéntico y ≥ 32 caracteres.
2. Activar `bot_orders_enabled` con `bot_orders_allowlist` (teléfonos del piloto) y topes explícitos.
3. Probar el pago con Mercado Pago sandbox de punta a punta y desplegar el Worker.
4. `get_customer` se sacó de la lista blanca de `guardrails.ts` (no existía como herramienta): la dirección se pregunta siempre. Es lo más simple y seguro; se puede implementar después vía `status`.

### Ajustes tras la revisión de experiencia
- Ningún error del servidor pasa la conversación a una persona: `limit_exceeded` muestra el motivo del servidor y ofrece la web; `forbidden` pide reintentar; `human_takeover` avisa que ya la atiende una persona; `closed` dice el horario; `product_unavailable` pide aclarar el producto; `rejected`/`http_409` muestran el motivo en español del servidor.
- Falla transitoria (red, timeout, 5xx, `unavailable`) en confirm/cancel: el bot manda «Tuve un problema al confirmar/cancelar tu pedido… Respondé SÍ para reintentar»; el SÍ siguiente reintenta SOLO esa operación (el texto de la plantilla define cuál). El wamid del nuevo SÍ es otro y el servidor devuelve el link vigente (`pendingPaymentLink`).
- Plantillas no falsificables: no existe columna de metadata en `wa_messages` sin migración, así que la marca es el prefijo del cuerpo guardado, y un texto libre del modelo que contenga cualquiera de esos marcadores se bloquea (no se envía, sin takeover).
- Solo «sí», «confirmo» y «dale» confirman pago o cancelación. Un SÍ sin resumen a la vista pide empezar de nuevo (no queda en un callejón).
- Fuera de la allowlist con el flag encendido: `pedido_nuevo`/`pedido_datos` responde «no disponible» sin gastar modelo (consulta barata a `status`), y `order_status` cae a la lectura legacy.
- El flag acepta `true` y `"true"` igual que el servidor. El link de pago se envía normalizado (`URL.href`); el cliente HTTP usa `redirect: "error"` y espera 250 ms antes del reintento de `claim_lost`.
- **App (`src/lib/whatsapp/notify.ts`)**: el aviso «pedido creado» ya no se omite para pedidos del canal WhatsApp pagados con Mercado Pago (el pedido nace al acreditarse el pago por webhook y el chat no vio ninguna confirmación). Efectivo en el chat no cambia. Efecto colateral: también aplica a pedidos MP creados por el agente de Next en producción (antes tampoco recibían aviso).

### Guion de prueba del piloto
Con el teléfono del dueño en `bot_orders_allowlist` y `bot_orders_enabled = true`:
1. Escribir «hola»: responde saludo (sin pedido).
2. «¿Qué pizzas tienen?»: lista el menú real.
3. «Quiero 2 muzzas a Av. Corrientes 1234»: llega el resumen con plantilla fija (líneas, subtotal, envío, total, dirección y «¿Pagás en efectivo o con Mercado Pago? Respondé SÍ EFECTIVO o SÍ MERCADO PAGO»).
4. Cambiar algo («mejor 3»): llega un resumen NUEVO (no un «listo, agregué»).
5. Responder «sí»: llega el link de Mercado Pago (dominio mercadopago/mpago.la) y el total.
5b. Repetir con «SÍ EFECTIVO»: llega «¡Listo! Tu pedido quedó confirmado ✅» con número, total y demora, y el pedido aparece en Recibidos (canal WhatsApp) sin venta en Fudo.
6. Pagar en sandbox: llega el aviso «pedido confirmado» y el pedido aparece en Recibidos de `/admin/tablero`.
7. Preguntar «¿cómo va mi pedido?»: informa el estado real.
8. Pedir un pedido y no pagar; preguntar «no me llega el link»: reenvía el link vigente y dice que falta pagar (sin decir «confirmado»).
9. Responder «sí pero sin cebolla» a un resumen: NO confirma, vuelve a cotizar o aclara.
10. Escribir «quiero cancelar»: pregunta con plantilla; responder «sí» cancela (solo en Recibidos); con el pedido ya en preparación explica el motivo.
11. Con un pedido fuera de zona o por debajo del mínimo: explica el motivo y ofrece rearmar.
12. Apagar `bot_orders_enabled`: «quiero una pizza» deriva a la web como antes.
13. Desde otro número fuera de la allowlist: «quiero una pizza» responde «no disponible, hacelo desde la web» y `¿y mi pedido?` sigue funcionando.
14. Cortar la red del Worker o poner un secreto incorrecto un momento: el bot ofrece «Respondé SÍ para reintentar» y, restablecido, el SÍ completa la operación sin duplicar el pedido.

### Diferido (revisión de experiencia)
Resumen con tiempo estimado y notas, plantillas nuevas de Meta, alerta al local por takeover y pruebas contra Mercado Pago sandbox.

### Saludo, promos del día y reclamos fuera de horario (2026-11-17)
- **Saludo primero** (`bot/greeting.ts`, `bot/turn.ts`): si el bot nunca respondió en la conversación o su último mensaje saliente (`wa_messages`, `direction='out'`) es de hace más de **6 h**, manda un saludo fijo (sin modelo): «¡Hola, {primer nombre}! 👋 Soy {agente_nombre}, el asistente de {negocio_nombre}. Te ayudo con lo que necesites: consultame cualquier duda o armamos tu pedido. ¿Qué querés pedir hoy?» + promos de hoy. Nombre = `coalesce(clients.name, contact_name)`; sin nombre «¡Hola! 👋»; sin `agente_nombre` «Soy el asistente de …». Con el local cerrado no pregunta qué pedir: dice el horario. Nunca ofrece una persona. Si el primer mensaje es saludo, «quiero pedir» u otro poco claro, el turno termina con el saludo (sin el link a la web); si pregunta algo concreto, después del saludo se responde normal.
- **Promos del día**: productos activos y visibles de la categoría «Promos» (`repo.menu()`), que nombran el día de hoy (hora de Argentina) o ningún día; «FINDE» = viernes a domingo; «X a Y» = rango; ALMUERZO antes de las 16, CENA desde las 18; nunca «SEÑA»/«SENA EVENTO» ni «Adicional». Máximo 5. Herramienta `get_promos_hoy` para «¿qué promos hay?». `kb_negocio` (promo) sigue igual.
- **Quejas fuera de horario**: con el local cerrado no hay nadie, así que el bot **no** deriva ni pone `human_takeover`: registra un ticket en `reclamos` (migración D1 `0014_reclamos.sql`, **sin aplicar**) y avisa que el local lo contacta al abrir (con la hora de apertura). Se ven en `/admin/conocimiento` («Reclamos fuera de horario», abierto/resuelto). Dentro de horario la queja deriva a una persona como siempre.

### Corte de emergencia
Dos formas, de la más rápida a la más fina: (1) borrar `BOT_INTERNAL_SECRET` en Vercel (y redeploy): todo el endpoint pasa a 503;
(2) `bot_orders_enabled = false` en `global_config` (efecto inmediato, el bot sigue informando y puede consultar/cancelar).

### Contrato común
Cuerpo JSON estricto (campos de más → 400 `invalid_body`). Siempre trae `conversationId` e `inboundWamid`; **nunca** `clientId`, precios, totales ni `rewardId`.
El servidor carga la conversación y verifica que `inboundWamid` exista en `wa_messages` de esa conversación, sea `in` y tenga ≤ 10 min; si no, 403 `forbidden`.
Cliente y teléfono se derivan de la conversación. Errores: `{ ok:false, code, error }`; éxito: `{ ok:true, ... }`.
Códigos: `closed`, `no_draft`, `expired`, `not_confirmed`, `claim_lost`, `out_of_zone`, `min_order`, `product_unavailable`, `total_changed`, `orders_disabled`, `payment_not_supported`, `limit_exceeded`, `forbidden`.

| Endpoint | Cuerpo | Éxito |
|---|---|---|
| `quote` | `items[1..30]{product_id, qty 1..20}`, `address` (5..200) | `lines, subtotal, delivery_fee, total, zone, resolved_address`. Guarda el borrador (30 min) con el `inboundWamid` |
| `confirm` | `payment_method` (`"Efectivo"` o `"Mercado Pago"`, otro → 400 `payment_not_supported`), `notes` ≤ 300. Header `Idempotency-Key` = `inboundWamid` | Mercado Pago: `awaiting_payment:true, payment_url, total` (el pedido se crea al acreditarse el pago). Efectivo: `order_code, total, payment_method` (el pedido se crea ya en `Recibidos`, canal `whatsapp`, por `createDeliveryOrder`, el mismo camino que el portal) |
| `cancel` | `confirmed: true` (si no → 400 `not_confirmed`). Header `Idempotency-Key` = `inboundWamid` | Cancela el pago pendiente o un pedido en `Recibidos` |
| `status` | solo los comunes | `found`, estado del último pedido o pago pendiente |

`confirm` exige un `inboundWamid` distinto **y posterior** (por `created_at` en `wa_messages`) al que cotizó. Idempotencia: el resultado de `confirm`/`cancel`
se guarda en `wa_conversations.state.botIdem`; repetir la misma clave devuelve el mismo resultado con `replayed:true`. Cada llamada deja un `console.info`
con ids (sin datos personales); los pedidos y cancelaciones quedan en `order_events` con actor `bot`.

## Verificación
- Unit + contrato: `npm test` y `vitest` del Worker (repo en memoria y SQL).
- `wrangler dev --remote` con Hyperdrive real + número de prueba de Meta: «hola» → menú → pedido → aparece en
  `/admin/tablero`; un segundo «sí» no duplica; BAJA desactiva promos.
- Latencia: medir con `wrangler tail` el tiempo de respuesta a Meta (objetivo < 100 ms) y del mensaje completo
  (objetivo: lo que tarde el modelo + < 300 ms de base).
- Seguridad: POST sin firma → 401; el rol `deli_bot` no puede leer tablas ajenas (probarlo con un `select`).

## Pendientes de decisión
- **Plan de Workers**: Paid (USD 5/mes, Queues y más CPU) o Free (solo `waitUntil`, 10 ms CPU por pedido:
  probablemente insuficiente para el agente).
- **Región de Supabase**: Hyperdrive rinde más si el Worker corre cerca; activar *Smart Placement*.
- **Supabase Realtime**: el tablero escucha cambios de `orders`; insertar por Postgres directo dispara igual los eventos.
