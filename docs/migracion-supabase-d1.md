# Migración Supabase → Cloudflare D1 (plan, no ejecutado)

Estado: **plan + artefactos**. Nada de esto se aplicó: no se creó ninguna base D1 remota, no se tocó Supabase, no se cortó nada.
Cuenta destino única: **Opsyn-La gambeta Dely** (`e7351dd776e005da826ba6f2a5aae4c1`).

Artefactos:
- `d1/schema/0001_inicial.sql`: esquema traducido a SQLite (probado en SQLite local: crea todo, FKs, índices parciales, triggers).
- `scripts/migrar-datos-d1.mjs`: export solo lectura → transform → `datos.sql` + `verificar.sql` + `conteos.json`.

---

## 1. Inventario de lo que usa Supabase

Relevado con grep de `supabase`, `.from(`, `.rpc(`, `.channel(`, `auth.`, `storage` y contra la base real (2026-11-12).

| Pieza de Supabase | Uso real hoy | Volumen |
|---|---|---|
| **Postgres (datos)** | 22 tablas de la app (ver §2). 123 archivos tocan Supabase; 96 usan el cliente service-role (`src/utils/supabase/admin.ts`). | ~7.300 filas (orders 1.686, order_items 3.537, clients 1.213, fudo_sync_runs 507, products 125…) |
| **Auth** | Email+password (`signInWithPassword`), `signOut`, `getUser` (8 lugares), `verifyOtp`, `updateUser`; Admin API: `createUser`, `generateLink`, `getUserById`, `updateUserById`, bloqueo. Rol en `app_metadata.role` (`admin`/`cliente`/`repartidor`). Repartidores entran con PIN (`/api/auth/courier-pin`) que por detrás es una sesión Supabase. Cookies SSR vía `@supabase/ssr` (`src/utils/supabase/server.ts`, proxy). | 7 usuarios |
| **RLS** | Políticas en todas las tablas, pero la mayoría de las rutas usan service-role y validan en código (`src/lib/auth/requireRole.ts`, `requireClient.ts`, `adminGuard.ts`, `courier.ts`). El navegador solo usa el cliente anónimo para Auth y Realtime. | — |
| **Realtime** | Solo **broadcast** (no postgres_changes): triggers `notify_*` hacen `realtime.send` de un "ping" por topic (orders, wa_conversations, wa_messages, wa_campaigns, courier_shifts). Cliente: `src/lib/live-channel.ts` + `useLiveRefresh` refetchean al recibir el ping. | 5 topics |
| **Triggers / funciones** | `handle_new_user` (crea `clients` al registrarse), `set_updated_at` (6 tablas), `update_client_points` (ledger → total), `protect_client_columns` (impide que un cliente edite tier/puntos), `orders_link_fudo_client` (vincula pedido Fudo a cliente), `fudo_anonymous_client(...)`, 5× `notify_*`. **No hay `.rpc(` en el código.** | 11 funciones de la app |
| **Storage** | **No se usa** (0 buckets). Las imágenes ya van a R2 `deli-gastro-productos` por el Worker `uploads`. | — |
| **Hyperdrive / Postgres directo** | `workers/whatsapp-bot` usa `postgres` sobre Hyperdrive con rol `deli_bot` (migraciones 015–016: vista de secretos). Los demás Workers (`fudo-gateway`, `pedidos-webhook`, `finanzas-sync`) usan PostgREST con service-role. | 1 Worker con SQL crudo |
| **Crons** | Ya son Cron Triggers de Cloudflare (`encuestas-cron`, `finanzas-sync`, `fudo-gateway`) que llaman a la app. Sin pg_cron propio de la app. | — |

Tablas por frecuencia de uso en código (`.from(`): orders 43, products 24, wa_conversations 21, payment_intents 21, clients 21, categories 19, wa_messages 16, order_events 10, reviews 9, couriers 8, global_config 7, points_ledger 6, integration_secrets 6, wa_campaigns 5, courier_shifts 5, fudo_product_map 4, delivery_zones 4, legal_acceptances 3, fudo_payment_map 3, courier_locations 3, order_items 1. El listado archivo por archivo está en el **Anexo A**.

**Fuera de alcance (sistema ajeno, misma base):** recetas, insumos_maestro, ordenes_compra, ordenes_detalle, ventas_turno, ventas_detalle, productos_vendidos, mermas, promos, promo_items, proveedores, receta_*, unidades, menu_personal_planning, pedido_semanal_template, precios_historico_insumos, perfiles_usuario, flujo_financiero, sync_log, telegram_sessions, reclamos y vistas `vista_*`, más sus funciones (`ajustar_stock`, `generar_numero_pedido`, `fn_registrar_cambio_precio`, `get_user_rol`). Se quedan en Supabase. Consecuencia: **Supabase no se puede dar de baja** mientras ese sistema viva ahí.

## 2. Mapa de cada pieza a Cloudflare

| Supabase | Cloudflare | Notas |
|---|---|---|
| Postgres (22 tablas) | **D1** `deli-gastro` (binding `DB`) | Esquema en `d1/schema/0001_inicial.sql`. Acceso con una capa de repositorios (`src/lib/db/*`) en vez de `supabase.from()`; recomendado **Drizzle ORM** (soporta D1, tipado, builder parecido). |
| Auth | Auth propia sobre D1 (ver §4) | Tablas `users`, `sessions`, `auth_tokens`. |
| RLS | Chequeos en código | Ya está casi todo así (96/123 archivos usan service-role). Regla: ninguna consulta sin `requireRole`/`requireClient`, y consultas de cliente siempre filtran por `client_id` de la sesión. Tests por ruta. |
| Realtime broadcast | **Durable Object `LiveHub`** con WebSockets hibernables (o polling, ver §5) | Mismo contrato que hoy: un "ping" por topic. |
| Triggers de negocio | Código en la capa de repositorio | `handle_new_user` → al registrar; `protect_client_columns` → whitelist de columnas en el update del perfil; `orders_link_fudo_client` + `fudo_anonymous_client` → función en el import de Fudo; `notify_*` → `live.ping(topic)` tras escribir. `set_updated_at` y `update_client_points` quedan como triggers SQLite. |
| Storage | R2 `deli-gastro-productos` | Ya migrado. Nada que hacer. |
| Hyperdrive + `deli_bot` | Binding D1 directo en `whatsapp-bot` | Se elimina Hyperdrive y la vista de secretos; secretos a Secrets Store/`wrangler secret` (decisión D5). |
| PostgREST desde Workers | Binding D1 (mismo `database_id`) en cada Worker | `fudo-gateway`, `pedidos-webhook`, `finanzas-sync`. |
| Crons | Cron Triggers (ya existen) | Sin cambio. |

## 3. Límites de D1 que nos afectan

| Límite / diferencia | Impacto | Mitigación |
|---|---|---|
| SQLite: sin `uuid`, `timestamptz`, `jsonb`, `numeric`, `bool` | Cambio de tipos en todo el código (bool llega como 0/1, JSON como string). | Convenciones en el encabezado del esquema; Drizzle mapea bool/json automáticamente (`mode: "boolean"`, `mode: "json"`). |
| Sin zonas horarias | Reportes por día (`reports_daily`, tablero ejecutivo, `shift_day`) hoy usan `AT TIME ZONE 'America/Argentina/Buenos_Aires'`. | Calcular el día en código; guardar UTC ISO. Revisar `src/lib/reports`, `daily-summary`, `executive`. |
| Sin `regexp_replace`, sin `ILIKE` (LIKE es case-insensitive solo ASCII) | Búsqueda de clientes por teléfono y por nombre con acentos. | Columna `phone_digits` mantenida en código; normalizar nombre a minúsculas sin acentos en otra columna si hace falta. |
| Tamaño de base: 10 GB máx. (plan pago) | Hoy ~unos MB; sin problema por años. | Purga de `fudo_sync_runs` y `wa_messages` viejos. |
| Una consulta: ~30 s, resultado/fila hasta ~2 MB, 100 parámetros por sentencia | Imports masivos de Fudo y export de clientes. | Lotes con `db.batch()` de ≤100 filas; paginar. |
| **Sin transacciones interactivas** (`BEGIN … COMMIT` desde código) | Flujos que hoy leen-y-escriben: confirmación de pago MP → crear pedido, puntos, alta de cliente anónimo. | `db.batch([...])` es atómico; o un Durable Object como serializador; o `UPDATE … WHERE status='pending'` + chequeo de filas afectadas (concurrencia optimista). |
| **Escritura de un solo hilo** por base | Varios Workers escribiendo a la vez (crons Fudo + webhook WhatsApp + app). Volumen chico, pero un import largo bloquea a los demás. | Imports en lotes cortos; reintentos ante `D1_ERROR: database is locked`/overloaded. |
| Réplicas de lectura (Sessions API) con consistencia eventual | Leer justo después de escribir podría ver dato viejo. | Usar `withSession("first-primary")` en rutas que escriben y releen. |
| Sin `LISTEN/NOTIFY` ni realtime nativo | Tablero en vivo. | §5. |
| Backups | Time Travel de D1: 30 días punto en el tiempo. | Además export diario a R2 (`wrangler d1 export`) desde un cron. |

## 4. Reemplazo de Auth (opciones concretas en Workers)

| Opción | Pros | Contras |
|---|---|---|
| **A. Auth propia mínima sobre D1 (recomendada)** — sesiones opacas en cookie `HttpOnly`, tabla `sessions`, contraseñas PBKDF2-SHA256 con WebCrypto (nativo en Workers, 100k iteraciones), tokens de un solo uso para recuperación/verificación vía Resend. | Sin dependencias ni costo; encaja con los 3 roles y el PIN de repartidor que ya es propio; todo en la cuenta única. | Hay que escribir y testear login, logout, recuperación, verificación de email y rate limit (~400 líneas). Responsabilidad de seguridad nuestra. |
| B. **Better Auth** con adaptador D1 (Kysely/Drizzle) | Librería mantenida, trae email+password, verificación, reset, roles (plugin admin), funciona en Workers. | Dependencia grande; su esquema (`user`, `session`, `account`, `verification`) obliga a remapear; hashing scrypt pesado en CPU de Workers (límite de CPU por request). |
| C. Cloudflare Access / Zero Trust | Muy bueno para el **admin** (SSO, sin contraseñas). | No sirve para clientes finales ni repartidores con PIN. Puede combinarse con A para `/admin`. |
| D. Proveedor externo (Clerk, Auth0) | Cero código de auth. | Sale de Cloudflare (contradice el objetivo) y cuesta. |

**Migración de contraseñas:** Supabase guarda bcrypt en `auth.users.encrypted_password`. El script lo copia a `users.legacy_bcrypt` (solo si se da `SUPABASE_DB_URL`); al primer login se verifica con bcrypt (`bcryptjs`, puro JS) y se re-hashea a PBKDF2. Si no se copian los hashes, los 7 usuarios hacen "olvidé mi contraseña" (son pocos: opción válida). Los `user_id` se conservan, así que las FKs (`clients`, `couriers`, `legal_acceptances`…) no cambian.

## 5. Reemplazo de Realtime

| Opción | Cómo | Veredicto |
|---|---|---|
| **A. Durable Object `LiveHub` con WebSocket Hibernation (recomendada)** | Un DO por topic (`orders`, `wa:<id>`, …). El navegador abre `wss://opsyndely…/api/live?topic=orders`; tras cada escritura el código hace `env.LIVE.get(id).fetch('/ping')` y el DO hace `broadcast`. Con hibernación no se cobra el tiempo ocioso. | Mantiene el contrato actual (ping → refetch) de `live-channel.ts`; cambio acotado a ese archivo y a los puntos de escritura. Ya usamos DOs en `whatsapp-bot`. |
| B. Polling | `useLiveRefresh` refetchea cada 5–10 s; con `If-None-Match`/`updated_at` máximo. | Lo más simple y robusto; costo extra de lecturas D1 bajo. **Sirve como fallback** y como primer paso del corte. |
| C. Server-Sent Events desde un DO | Igual que A pero unidireccional. | Sin ventaja real frente a A. |

Plan: implementar B primero (corte sin riesgo) y luego A.

## 6. Plan por fases con corte gradual

Cada fase termina en un PR propio; ninguna se despliega sin OK.

| Fase | Contenido | Esfuerzo |
|---|---|---|
| **0. Base** | Crear D1 `deli-gastro` en la cuenta e7351 (con OK), aplicar `0001_inicial.sql`, bindings en `wrangler.jsonc` de la app y Workers. Probar `scripts/migrar-datos-d1.mjs` en `--local`, luego en remoto. | 1 día |
| **1. Capa de datos** | `src/lib/db/` con Drizzle: un repositorio por agregado (orders, clients, catalog, whatsapp, couriers, payments, config). Implementación doble: `SupabaseRepo` y `D1Repo` detrás de la misma interfaz, elegida por flag `DATA_BACKEND=supabase|dual|d1`. Reescribir los 123 archivos para usar repos en vez de `supabase.from()`. | 6–8 días |
| **2. Escritura doble + lectura sombra** | `dual`: escribe en Supabase (fuente de verdad) y en D1; las lecturas salen de Supabase y en paralelo se lee D1 y se registran diferencias (log en Workers Analytics). Re-sincronizar con el script (idempotente) para cerrar huecos. | 2 días + 1 semana de observación |
| **3. Auth** | Auth propia (§4), import de usuarios, migración de sesiones (los usuarios se re-loguean una vez), PIN de repartidores contra `couriers` en D1. Proxy (`src/proxy.ts`) lee la cookie nueva. | 4–5 días |
| **4. Realtime** | Polling primero; luego DO `LiveHub`. Quitar triggers `notify_*` de la ruta crítica. | 2–3 días |
| **5. Workers** | `whatsapp-bot` (quitar Hyperdrive/`postgres`), `fudo-gateway`, `pedidos-webhook`, `finanzas-sync` a binding D1. Secretos fuera de `integration_secrets`. | 3 días |
| **6. Corte** | Ventana de bajo tráfico (mañana): congelar escrituras 5 min, sync final, verificar conteos, `DATA_BACKEND=d1`, D1 pasa a fuente de verdad. Supabase queda solo lectura para la app 2 semanas. | ½ día |
| **7. Limpieza** | Quitar `@supabase/*`, Hyperdrive, variables `SUPABASE_*` de la app. Las tablas de la app en Supabase se dejan (o se archivan) — **no** se toca el sistema ajeno. | 1 día |

**Total estimado: 20–25 días de desarrollo** (≈ 4–5 semanas calendario con la observación de la fase 2), incluyendo tests E2E (`npm run e2e`) por fase.

### Rollback
- Fases 1–5: el flag `DATA_BACKEND=supabase` vuelve al estado actual al instante (Supabase sigue siendo fuente de verdad).
- Después del corte (fase 6): durante 2 semanas se puede volver; las escrituras hechas en D1 se re-exportan a Supabase con un script inverso (pendiente: `scripts/d1-a-supabase.mjs`) o se mantiene escritura doble invertida (D1 primario, Supabase secundario) esas 2 semanas — **recomendado**.
- D1 Time Travel permite volver la base a cualquier minuto de los últimos 30 días.

## 7. Riesgos

1. **Supabase no desaparece**: el sistema de recetas/insumos sigue ahí; el ahorro de costo puede ser nulo si ese sistema necesita el plan pago.
2. **Auth propia** = superficie de seguridad nuestra (hashing, rate limit, recuperación, fijación de sesión). Requiere revisión de seguridad dedicada.
3. **Pérdida de RLS como red de seguridad**: un bug en un chequeo de código expone datos de otros clientes. Mitigar con tests de autorización por ruta.
4. **Atomicidad**: sin transacciones interactivas, flujos de pago MP y puntos pueden quedar a medias. Rediseñar con `batch()`/concurrencia optimista.
5. **Fechas y zona horaria**: reportes diarios pueden correrse 3 h si no se calcula bien el día argentino.
6. **Volumen del cambio**: 123 archivos; riesgo de regresiones en flujos poco usados (campañas WA, legales, demo).
7. **Escritura de un solo hilo**: un import Fudo grande puede demorar webhooks de WhatsApp (bajo con el volumen actual).
8. **Doble escritura** puede divergir si falla una de las dos: hay que loguear y reconciliar con el script.

## 8. Decisiones abiertas para el usuario

- **D1. ¿Vale la pena?** Supabase igual queda por el sistema ajeno. ¿El objetivo es costo, simplicidad o "todo en Cloudflare"? Si es costo, primero confirmar cuánto se ahorra realmente.
- **D2. Auth:** ¿auth propia (recomendado) o Better Auth? ¿Admin con Cloudflare Access además?
- **D3. Contraseñas:** ¿copiar hashes bcrypt (requiere connection string de Supabase) o pedir a los 7 usuarios que reseteen?
- **D4. Realtime:** ¿alcanza con polling cada ~5 s o se quiere el Durable Object (instantáneo)?
- **D5. Secretos** (`integration_secrets`, 8 filas): ¿pasarlos a secretos de Worker / Secrets Store en vez de una tabla?
- **D6. Montos:** ¿REAL con redondeo (simple) o centavos enteros (exacto, más cambios)?
- **D7. Ventana de corte** y tolerancia a un re-login de todos los usuarios.
- **D8.** OK para **crear la base D1 remota** `deli-gastro` en la cuenta e7351 (fase 0).

---

## Anexo A — Archivos que usan Supabase

Columnas: tablas (`.from`), métodos de auth, y si usa Realtime o service-role. Las rutas sin tablas listadas acceden vía helpers de `src/lib/*`.

| Archivo | Tablas | Auth | Notas |
|---|---|---|---|
| `src/app/admin/carta/page.tsx` | - | - | service-role |
| `src/app/admin/pedidos/page.tsx` | - | - | service-role |
| `src/app/admin/pedidos/[id]/page.tsx` | clients,order_events,orders,reviews | - | service-role |
| `src/app/admin/productos/page.tsx` | categories,products | - | service-role |
| `src/app/admin/puntos/page.tsx` | categories,clients,orders,points_ledger,products | - | service-role |
| `src/app/admin/tablero/page.tsx` | - | - | service-role |
| `src/app/api/admin/catalog/export/route.ts` | - | - | service-role |
| `src/app/api/admin/catalog/import/route.ts` | - | - | service-role |
| `src/app/api/admin/clients/export/route.ts` | - | - | service-role |
| `src/app/api/admin/courier-shifts/route.ts` | - | - | service-role |
| `src/app/api/admin/couriers/route.ts` | - | - | service-role |
| `src/app/api/admin/couriers/[id]/pin/route.ts` | - | - | service-role |
| `src/app/api/admin/couriers/[id]/route.ts` | - | - | service-role |
| `src/app/api/admin/daily-summary/route.ts` | - | - | service-role |
| `src/app/api/admin/executive/route.ts` | orders,reviews | - | service-role |
| `src/app/api/admin/executive/settings/route.ts` | global_config | - | service-role |
| `src/app/api/admin/fudo-map/route.ts` | - | - | service-role |
| `src/app/api/admin/legal/route.ts` | legal_acceptances | - | service-role |
| `src/app/api/admin/reports/export/route.ts` | - | - | service-role |
| `src/app/api/admin/reports/route.ts` | - | - | service-role |
| `src/app/api/agent/config/route.ts` | - | - | service-role |
| `src/app/api/agent/test/route.ts` | wa_conversations | - | service-role |
| `src/app/api/auth/courier-pin/route.ts` | - | - | service-role |
| `src/app/api/categories/route.ts` | categories,products | - | service-role |
| `src/app/api/chat/route.ts` | - | getUser |  |
| `src/app/api/client/orders/route.ts` | orders | - | service-role |
| `src/app/api/client/orders/[id]/route.ts` | orders,reviews | - | service-role |
| `src/app/api/client/payments/[id]/route.ts` | - | - | service-role |
| `src/app/api/client/quote/route.ts` | - | - | service-role |
| `src/app/api/config/route.ts` | global_config | - | service-role |
| `src/app/api/couriers/location/route.ts` | - | - | service-role |
| `src/app/api/cron/daily-summary/route.ts` | - | - | service-role |
| `src/app/api/cron/surveys/route.ts` | - | - | service-role |
| `src/app/api/demo/payments/[id]/route.ts` | payment_intents | - | service-role |
| `src/app/api/geocode/route.ts` | - | - | service-role |
| `src/app/api/integrations/fudo/status/route.ts` | - | - | service-role |
| `src/app/api/legal/acceptances/route.ts` | legal_acceptances | admin.updateUserById | service-role |
| `src/app/api/orders/delivered/route.ts` | - | - | service-role |
| `src/app/api/orders/route.ts` | order_events,orders | - | service-role |
| `src/app/api/payments/mercadopago/webhook/route.ts` | - | - | service-role |
| `src/app/api/products/route.ts` | categories,products | - | service-role |
| `src/app/api/reviews/route.ts` | clients,orders,reviews | getUser | service-role |
| `src/app/api/whatsapp/campaigns/preview/route.ts` | - | - | service-role |
| `src/app/api/whatsapp/campaigns/route.ts` | wa_campaigns | - | service-role |
| `src/app/api/whatsapp/config/route.ts` | - | - | service-role |
| `src/app/api/whatsapp/conversations/route.ts` | clients,wa_conversations,wa_messages | - | service-role |
| `src/app/api/whatsapp/conversations/[id]/route.ts` | wa_conversations,wa_messages | - | service-role |
| `src/app/api/whatsapp/embedded-signup/route.ts` | - | - | service-role |
| `src/app/api/whatsapp/link/route.ts` | - | - | service-role |
| `src/app/api/whatsapp/openwa/webhook/route.ts` | - | - | service-role |
| `src/app/api/whatsapp/templates/route.ts` | - | - | service-role |
| `src/app/api/whatsapp/test/route.ts` | - | - | service-role |
| `src/app/api/whatsapp/webhook/route.ts` | - | - | service-role |
| `src/app/api/zones/route.ts` | delivery_zones | - | service-role |
| `src/app/cliente/carrito/page.tsx` | categories,products | - |  |
| `src/app/cliente/fidelidad/page.tsx` | points_ledger | - |  |
| `src/app/cliente/page.tsx` | categories,orders,products | - |  |
| `src/app/cliente/pedidos/page.tsx` | orders,points_ledger,reviews | - |  |
| `src/app/cliente/pedidos/[id]/page.tsx` | orders,reviews | - |  |
| `src/app/cliente/perfil/page.tsx` | clients,orders | getUser,signOut |  |
| `src/app/demo/mercadopago/[id]/page.tsx` | payment_intents | - | service-role |
| `src/app/login/page.tsx` | - | signInWithPassword |  |
| `src/app/repartidor/layout.tsx` | - | getUser |  |
| `src/app/repartidor/page.tsx` | - | getUser | service-role |
| `src/components/ui/SignOutButton.tsx` | - | signOut |  |
| `src/lib/agent/conversation-state.ts` | wa_conversations | - | service-role |
| `src/lib/agent/handler.ts` | wa_messages | - | service-role |
| `src/lib/agent/order-actions.ts` | clients,orders,wa_conversations | - | service-role |
| `src/lib/agent/reply.ts` | clients,wa_messages | - | service-role |
| `src/lib/agent/settings.ts` | integration_secrets | - | service-role |
| `src/lib/agent/tools.ts` | categories,products,wa_conversations | - | service-role |
| `src/lib/auth/clientPage.ts` | - | getUser | service-role |
| `src/lib/auth/courier.ts` | - | - |  |
| `src/lib/auth/requireClient.ts` | - | - | service-role |
| `src/lib/auth/requireRole.ts` | - | getUser |  |
| `src/lib/auth/roles.ts` | - | admin.updateUserById,updateUser |  |
| `src/lib/bot-internal/handlers.ts` | global_config,orders,wa_conversations,wa_messages | - | service-role |
| `src/lib/bot-internal/route.ts` | - | - | service-role |
| `src/lib/catalog/apply.ts` | categories,products | - | service-role |
| `src/lib/courier-auth.ts` | - | admin.createUser,admin.generateLink,admin.getUserById,admin.updateUserById,verifyOtp | service-role |
| `src/lib/courier-location.ts` | courier_locations | - | service-role |
| `src/lib/courier-pin-crypto.ts` | demo | - |  |
| `src/lib/courier-pins.ts` | couriers | createUser | service-role |
| `src/lib/courier-shifts.ts` | courier_shifts | - | service-role |
| `src/lib/couriers.ts` | - | - | service-role |
| `src/lib/daily-summary/send.ts` | global_config,orders | - | service-role |
| `src/lib/delivered-map-server.ts` | clients,orders | - | service-role |
| `src/lib/demo/browser-client.ts` | - | - |  |
| `src/lib/demo/chatbot.ts` | orders,products | - | service-role |
| `src/lib/demo/fake-client.ts` | - | - |  |
| `src/lib/demo/query.ts` | - | - |  |
| `src/lib/demo/server-client.ts` | - | - |  |
| `src/lib/demo/users.ts` | - | - |  |
| `src/lib/fudo/catalog-lock.ts` | - | - |  |
| `src/lib/fudo/demo-sync.ts` | categories,fudo_product_map,products | - | service-role |
| `src/lib/fudo/gateway.ts` | - | - | service-role |
| `src/lib/fudo/mapping.ts` | fudo_payment_map,fudo_product_map,orders,products | - | service-role |
| `src/lib/fudo/save-request.ts` | - | - | service-role |
| `src/lib/fudo/status.ts` | order_events,orders | - | service-role |
| `src/lib/live-channel.ts` | - | - | realtime |
| `src/lib/orders-create.ts` | categories,order_events,order_items,orders,payment_intents,products | - | service-role |
| `src/lib/orders-server.ts` | clients,global_config,orders,points_ledger | - | service-role |
| `src/lib/payments/intents.ts` | order_events,payment_intents | - | service-role |
| `src/lib/payments/refunds.ts` | payment_intents | - | service-role |
| `src/lib/payments/webhook.ts` | - | - | service-role |
| `src/lib/reports/data.ts` | clients,orders,products,reviews | - | service-role |
| `src/lib/whatsapp/campaigns.ts` | clients,orders,wa_campaigns,wa_conversations,wa_messages | - | service-role |
| `src/lib/whatsapp/clients.ts` | clients,wa_conversations | - | service-role |
| `src/lib/whatsapp/config.ts` | integration_secrets | - | service-role |
| `src/lib/whatsapp/connected-by-store.ts` | integration_secrets | - | service-role |
| `src/lib/whatsapp/inbound.ts` | clients,wa_conversations,wa_messages | - | service-role |
| `src/lib/whatsapp/notify.ts` | clients,orders,reviews,wa_conversations,wa_messages | - | service-role |
| `src/lib/whatsapp/pipeline.ts` | clients,wa_messages | - |  |
| `src/lib/whatsapp/signup-flow.ts` | - | - |  |
| `src/lib/zones-server.ts` | delivery_zones | - | service-role |
| `src/proxy.ts` | - | getUser |  |
| `src/utils/supabase/admin.ts` | - | - | service-role |
| `src/utils/supabase/client.ts` | - | - |  |
| `src/utils/supabase/server.ts` | - | - |  |
| `workers/finanzas-sync/src/index.ts` | - | - | service-role |
| `workers/fudo-gateway/src/db.ts` | - | - | service-role |
| `workers/pedidos-webhook/src/index.ts` | - | - | service-role |
| `workers/whatsapp-bot/src/guardrails.ts` | - | - |  |
