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
| `pedido_*` | Tomador de pedidos (máquina de estados, ver abajo) | `get_menu`, `get_customer`, `quote_order`, `confirm_order`, `cancel_order` |
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
| 5. Pedidos y pagos | Pendiente. |
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
