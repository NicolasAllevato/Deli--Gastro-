# Integración Fudo ↔ Deli-Gastro (Opsyn Dely)

Fuente: especificación OpenAPI oficial `https://integrations.fu.do/fudo/v1/openapi.yml`
(la que renderiza `dev.fu.do/integrations-api`) y el artículo de soporte
"Integración de pedidos externos vía APIs". Leída el 2026-10-20.

## 1. Qué ofrece la API de integraciones

| Acción | Endpoint | Uso para nosotros |
|---|---|---|
| Obtener token | `POST /auth` (`clientId`, `clientSecret`) | Token de 24 h; renovar antes de vencer |
| Listar productos | `GET /products` | Mapear nuestro catálogo a los IDs de Fudo (incluye modificadores) |
| Listar categorías | `GET /product-categories` | Mapear categorías |
| Crear pedido | `POST /orders` | Enviar a Fudo cada pedido nuestro (web y WhatsApp) |
| Webhooks | `ORDER-REJECTED`, `-CONFIRMED`, `-READY-TO-DELIVER`, `-DELIVERY-SENT`, `-CLOSED` | Traer a Deli-Gastro los cambios de estado hechos en Fudo |

Base URL: `https://integrations.fu.do/fudo`

Cabeceras en cada llamada autenticada:
- `Fudo-External-App-Authorization: Bearer <token>`
- `Fudo-Integrator-Token: <token>` (sin `Bearer`). Lo emite Fudo a integradores registrados;
  si falta o no coincide → `401`.

Webhooks: cabecera `fudo-signature` = HMAC-SHA256 hex del **cuerpo crudo**, firmado con el
`clientSecret`. Solo llegan para pedidos creados por esta API.

**No hay**: lectura de pedidos/ventas, cancelación desde la integración, edición de pedidos,
stock, clientes. Para eso Fudo menciona "una API más extensa" (`soporte@fu.do`).

## 2. Mapeo de pedido: Deli-Gastro → `POST /orders`

| Fudo (`order.*`) | Obligatorio | Deli-Gastro | Notas |
|---|---|---|---|
| `items[].product.id` | sí | `products.id` (uuid) | **Falta tabla de mapeo** uuid ↔ id entero de Fudo |
| `items[].quantity` | sí | `PricedOrder.lines[].qty` | |
| `items[].price` | sí | `PricedOrder.lines[].price` | Precio unitario nuestro |
| `items[].comment` | no | — | Máx. 254 |
| `items[].subitems[]` | no | — | No tenemos modificadores hoy |
| `type` | sí | `delivery` (siempre hoy) | `pickup` si sumamos retiro |
| `typeOptions.address` | sí* | `orders.delivery_address` | lat/lng no viajan; ir en `comment` si sirve |
| `typeOptions.expectedTime` | no | — | Podemos mandar hora estimada |
| `customer.name` | sí (si va customer) | `clients` (nombre) | Máx. 90 |
| `customer.phone` | no | `clients` / WhatsApp | Máx. 90 |
| `customer.email` | no | `clients` | |
| `shippingCost` | no | `orders.delivery_fee` | |
| `discounts[].amount` | no | descuento del canje de puntos (`AppliedReward.discount`) | Monto fijo |
| `payment.total` | sí (si va payment) | `orders.total` | |
| `payment.paymentMethod.id` | no | `orders.payment_method` (Efectivo/Tarjeta/Mercado Pago) | **Falta mapeo** a IDs de medios de pago de Fudo (la API pública no los lista) |
| `externalId` | no | `orders.id` (uuid) | Clave para cruzar webhooks; probar si Fudo deduplica |
| `comment` | no | `orders.notes` | Máx. 254 (nuestro `notes` admite 300 → recortar) |
| `people` | no | — | |

Respuesta `201` → `order.id` (entero). Guardarlo en `orders.fudo_order_id`.
Errores: `400` (con `dataPointer`) y `422`.

### Bloqueo de modelo de datos
`orders` solo guarda `items_desc` (texto). Las líneas estructuradas existen únicamente al
cotizar (`PricedOrder.lines` en `src/lib/orders-create.ts`) y no se persisten (tampoco en
`OrderSnapshot` de `payment_intents`). Para enviar a Fudo hay que:
1. Agregar al snapshot las líneas (`productId`, `qty`, `price`) y persistirlas
   (tabla `order_items` o columna `items jsonb` en `orders`).
2. Enviar a Fudo justo después de crear el pedido (`placeOrder`), tanto en efectivo
   como en el webhook de Mercado Pago.

## 3. Mapeo de estados: webhooks Fudo → `orders.status`

| Evento Fudo | `orders.status` | Timestamp | Comentario |
|---|---|---|---|
| (pedido creado) | `Recibidos` | `created_at` | Estado inicial nuestro y pendiente en Fudo |
| `ORDER-CONFIRMED` | `En Preparación` | `accepted_at` | Cocina aceptó en Fudo |
| `ORDER-REJECTED` | `Cancelado` | — | Disparar devolución de puntos y reembolso MP (`cancelOrderBySystem` → `settleCancellation`) |
| `ORDER-READY-TO-DELIVER` | `En Camino`* | `ready_at` | *Hoy "En Camino" = listo para despachar |
| `ORDER-DELIVERY-SENT` | `En Camino` | `picked_up_at` | Salió el repartidor |
| `ORDER-CLOSED` | `Finalizados` | `delivered_at` | Suma puntos, dispara encuesta |

Cada evento también se registra en `order_events` con `actor = 'fudo'`.

Huecos:
- No hay evento de cancelación posterior a confirmar. Si cancelan en Fudo después de confirmar,
  no nos enteramos.
- Si se cancela en Deli-Gastro (cliente/admin), no podemos avisar a Fudo por API.
- Doble fuente de estado: definir que **Fudo manda** el estado para pedidos sincronizados y el
  tablero de Deli-Gastro no permite moverlos a mano (salvo repartidor/mapa).
- Payload del webhook no está documentado: hay que capturar uno real en pruebas.

## 4. Lectura de ventas de Fudo (delivery, salón, otros canales)
No es posible con esta API. Opciones:
1. Pedir acceso a la API extendida de Fudo (`soporte@fu.do`) — preferida.
2. Exportes/reportes de Fudo importados periódicamente.

## 5. Cambios técnicos previstos (cuando se apruebe)
- Migración: `orders.fudo_order_id bigint unique`, `orders.fudo_sync_status`
  (`pending|sent|failed`), `orders.fudo_error`; tabla `fudo_product_map`
  (`product_id uuid` ↔ `fudo_product_id int`); líneas de pedido persistidas.
- Secretos (Worker / Vercel env): `FUDO_CLIENT_ID`, `FUDO_CLIENT_SECRET`, `FUDO_INTEGRATOR_TOKEN`.
- Cliente Fudo con caché del token (24 h) y reintentos con `externalId`.
- Endpoint/Worker de webhooks con verificación HMAC del cuerpo crudo y respuesta idempotente.
- Pantalla admin para mapear productos (usa `GET /products`) y medios de pago.

## 6. Qué pedir a Fudo
- Aprobación de la integración de pedidos externos.
- `Fudo-Integrator-Token` para OPSYN.
- IDs de medios de pago (o cómo obtenerlos).
- Ejemplo de payload de cada webhook.
- Si `externalId` deduplica pedidos.
- Entorno de pruebas / cuenta sandbox.
- Acceso a la API extendida para leer ventas.

## 7. Implementación (2026-10-24)

Migración `017_order_items_fudo.sql`: tabla `order_items`, columnas `orders.fudo_*`,
tablas `fudo_product_map` y `fudo_payment_map`.

Flujo:
1. `placeOrder` guarda las líneas en `order_items`. Si `FUDO_GATEWAY_URL` está configurada,
   marca el pedido `fudo_sync_status = 'pending'` y llama al Worker (`POST /sync`).
2. Worker `workers/fudo-gateway`: toma el pedido (lock optimista con `fudo_attempts`), arma el
   cuerpo (`src/payload.ts`) con los mapeos y hace `POST /orders` en Fudo. El token se cachea en KV 23 h.
   Resultado: `sent` (+ `fudo_order_id`), `failed` (se reintenta por cron cada 5 min, hasta 6 veces) o
   `skipped` (falta mapeo o Fudo rechazó con 400/422: se corrige y se vuelve a `pending` a mano).
3. Webhooks de Fudo → `POST <worker>/webhook` (firma `fudo-signature` con el clientSecret) →
   el Worker reenvía firmado a la app `POST /api/integrations/fudo/status`, que aplica el estado
   (`src/lib/fudo/status.ts`) con aviso por WhatsApp, puntos y devoluciones. Solo avanza; los repetidos se ignoran.
4. `GET <worker>/products` y `/product-categories` (firma HMAC del path) para la pantalla de mapeo.

Firmas app ↔ Worker: HMAC-SHA256 hex del cuerpo, header `x-gateway-signature`, secreto `FUDO_GATEWAY_SECRET`.

Puesta en marcha:
```bash
cd workers/fudo-gateway
npx wrangler kv namespace create FUDO_KV      # pegar el id en wrangler.toml
npx wrangler secret put FUDO_CLIENT_ID
npx wrangler secret put FUDO_CLIENT_SECRET
npx wrangler secret put FUDO_INTEGRATOR_TOKEN # cuando Fudo lo asigne
npx wrangler secret put FUDO_GATEWAY_SECRET
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler deploy
```
En Vercel: `FUDO_GATEWAY_URL` (URL del Worker) y `FUDO_GATEWAY_SECRET` (el mismo). En el panel de Fudo,
la URL de webhooks es `<worker>/webhook`.

Pantalla admin de mapeo: HECHA en `/admin/fudo` (Configuración > Fudo; API `/api/admin/fudo-map`).
- Productos: input de id con sugerencias del catálogo de Fudo (`GET /products` vía el Worker, forma real
  `{ products: [{ id, name, active, ... }] }`). Si el catálogo está disponible, el servidor valida que el id exista
  (400 si no) y guarda el nombre del catálogo.
- Medios de pago: la API de Fudo NO tiene endpoint para listarlos; los ids se piden a Fudo y se cargan a mano.
- Al guardar productos, los pedidos `skipped` por "Productos sin mapear a Fudo" de las últimas 24 h se reencolan a
  `pending` (con `fudo_attempts = 0`) y el Worker los reenvía en su próximo cron.

Pendiente: ajustar `parseFudoWebhook` con el
primer webhook real (queda en los logs del Worker); confirmar con Fudo si `externalId` deduplica
(si no, un timeout después de que Fudo creó el pedido puede duplicarlo al reintentar).
