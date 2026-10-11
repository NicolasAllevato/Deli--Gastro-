# Pendientes — Deli-Gastro

Estado al 2026-09-30, rama `feat/demo-local` (parte de `fix/security-design-cloudflare-supabase`).

## Resuelto en `feat/demo-local`

- Plataforma completa en **modo demo local** (`npm run demo`, ver `docs/DEMO.md`):
  tres portales (admin, cliente, repartidor) con datos de ejemplo en memoria.
- Se eliminaron los `fixtures`: catálogo, pedidos, mapa y detalle leen del almacén
  de datos como en producción.
- Flujo de pedido de punta a punta: checkout del cliente, tablero, repartidor,
  puntos, canje, reseñas y tickets (ver `docs/FLUJO_PEDIDO.md`).
- `middleware.ts` y `src/proxy.ts` coexistían (los dos corrían); quedó un solo
  `src/proxy.ts`.
- Mapa: los tiles y los íconos estaban bloqueados por la CSP; ahora usa OpenStreetMap
  y marcadores propios.
- Config: guardar los niveles de lealtad fallaba la validación (`puntos_min` vs
  `desde`); alineado.
- Rate limit: el contador se compartía entre todas las rutas de la misma IP.

## Nuevos pendientes para pasar a producción

- [x] Aplicar `supabase/migrations/004_order_delivery_reviews.sql` (reseñas y
      datos de entrega). Aplicada el 2026-10-03 desde el SQL Editor del proyecto
      `Delivery`; no figura en el historial de migraciones de Supabase porque no se
      corrió con el CLI.
- [x] Registro de clientes: ya lo cubre el trigger `on_auth_user_created` →
      `handle_new_user()` (crea la fila en `clients`; `clients_user_id_key` existe).
- [ ] Crear el usuario repartidor con `app_metadata.role = "repartidor"`. Recomendado:
      Dashboard → Authentication → Users → Add user (autoconfirmar) y después asignar
      el rol con un `UPDATE` de `raw_app_meta_data`. El admin ya existe.
- [x] Geocodificación de direcciones reales: hecha con Nominatim (`/api/geocode`); para
      producción con volumen conviene Google Geocoding o Mapbox.
- [x] Notificaciones y asistente: ahora por WhatsApp Cloud API + OpenAI, sin n8n. Ver
      `docs/WHATSAPP_AGENTE.md` (variables y pendientes).
- [x] Migraciones 005–009 (seguimiento de pedidos, zonas, WhatsApp, campañas y protección
      de columnas de `clients`): aplicadas el 2026-10-10 al proyecto `Delivery`
      (`wlznhichyivfcqwbosyi`) y verificadas (tablas, columnas, triggers y RLS). El proyecto
      estaba pausado y se reactivó.
- [x] Polling reemplazado por Supabase Realtime (2026-10-10). Migración `010_orders_realtime_ping.sql`
      (aplicada): un trigger en `orders` emite un aviso **sin datos** por Broadcast (canales `orders` y
      `order:<id>`) y las pantallas (`admin/tablero`, `admin/mapa`, `repartidor`, seguimiento del
      cliente) refrescan desde la API con `useLiveRefresh`. El polling queda de respaldo cada 30 s;
      en modo demo sigue siendo el rápido de antes. Probado con un suscriptor anónimo real. Falta
      verlo en el navegador con un admin real (se necesita sesión) y migrar `admin/conversaciones`,
      `admin/campanas` y el tablero ejecutivo, que todavía consultan por intervalo.
- [x] Tests E2E con Playwright (2026-10-10): `npm run e2e` (9 tests, ~2 min; levanta solo el modo
      demo en el puerto 5290). `e2e/acceso.spec.ts` cubre el guard de `src/proxy.ts` por rol y
      `e2e/pedido-completo.spec.ts` el flujo cliente → admin → repartidor → cliente entregado.
      Corre contra `next dev`, así que precalienta las rutas (`warmUpRoutes`); no ejercita
      Supabase real ni Realtime (eso solo se probó con un suscriptor suelto).
- [ ] Medición de cobertura (hay 227 tests unitarios de las piezas puras, sin reporte de porcentaje).
- [ ] E2E que falta: reseñas y canje de puntos, cancelación del cliente, y una pasada en CI.
- [ ] Decisiones abiertas de producto: ver `docs/FLUJO_PEDIDO.md` §8.

## Manuales (bloquean a Claude, requieren dashboard/CLI del usuario)

- [ ] **R2 API keys**: generar en Dashboard Cloudflare → R2 → Manage R2 API
      Tokens → permiso Object Read & Write, bucket `deli-gastro-productos`.
      Completar `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` en `.env.local`
      (y en Vercel). Sin esto, `/api/upload` no puede escribir a R2.
      Ver `docs/CLOUDFLARE_SETUP.md`.
- [x] **Workers deployados** (2026-10-11, cuenta "Proyectos OPSYN"): `pedidos-webhook` y
      `finanzas-sync`, con `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` y `WEBHOOK_SECRET`
      cargados. El `WEBHOOK_SECRET` está en `.env.local` y hay que dárselo a quien llame al
      webhook (firma HMAC-SHA256 hex del body en `x-webhook-signature`); hoy no hay llamador.
      Gotcha: subir secretos con pipe de PowerShell agrega `\r\n` al valor y rompe la firma;
      usar Node con `input` sin salto de línea o `wrangler secret bulk`. `cf deploy` (beta) exige
      `cloudflare.config.ts`; se despliega con `wrangler deploy` (4.136.0 pineado en cada Worker).
      Por ver: la primera corrida horaria de `finanzas-sync` escribiendo en `reports_daily`.
- [ ] **Leaked Password Protection** (Supabase Auth): activar en Dashboard
      → Authentication → Policies. Es config de servicio, no SQL.
- [x] **npm audit** (2026-10-10): Next 16.2.9 → **16.4.0** (y `eslint-config-next` 16.4.0) + `npm audit fix`.
      Pasó de 15 vulnerabilidades (1 crítica: bypass de Middleware/Proxy con Turbopack, que
      afectaba a `src/proxy.ts`) a 5. Verificado: `tsc`, lint, 227 tests, build y el guard del
      proxy en runtime (rutas protegidas → 307 a `/login`, APIs → 401).
      Quedan 5 `high` solo en la cadena de lint (`eslint-config-next` → `braces`/`micromatch`/
      `fast-glob`): dependencias de desarrollo, no entran al bundle; el único "fix" que ofrece
      npm es bajar a `eslint-config-next@14.2.35`, así que se dejan hasta que salga un parche.

## Fuera de alcance (pertenecen a otro proyecto en la misma base Supabase)

El proyecto Supabase `Delivery` (`wlznhichyivfcqwbosyi`) aloja, además de las
tablas de Deli-Gastro, ~21 tablas de un sistema de recetas/insumos/costos
(`recetas`, `insumos_maestro`, `ordenes_compra`, `ventas_turno`,
`telegram_sessions`, etc. — todas en 0 filas). No se tocaron.

- `vista_recetas_cocina` y `vista_costo_recetas` — SECURITY DEFINER (ERROR
  en advisors). El usuario mencionó un error de Fudo sobre esta vista — es
  del proyecto CRM-FRANKIE, no de Deli-Gastro. Sin resolver acá.
- Funciones `handle_new_user`, `get_user_rol`, `generar_numero_pedido`,
  `fn_registrar_cambio_precio`, `is_authenticated_or_anon`, `ajustar_stock`,
  `rls_auto_enable` — search_path mutable + ejecutables por `anon`/
  `authenticated` sin restricción (WARN). No se tocaron: pertenecen al
  otro subsistema y no se conoce su lógica de negocio real.

## Reconciliación de schema (ya resuelta, dejar como referencia)

- `supabase_schema.sql` (raíz) estaba desactualizado y ahora tiene un header
  `⚠️ OBSOLETO`. La fuente de verdad es `supabase/migrations/` (001, 002, 003),
  confirmada contra el schema real vía introspección REST + `list_tables`.
- Admin (`admin@deli-gastro.com`) reparado: rol movido de `user_metadata` a
  `app_metadata` directo en `auth.users` (la Admin API de GoTrue devolvía
  "Database error finding users" al listar usuarios — posible trigger
  `on_auth_user_created` del otro subsistema; no investigado a fondo, se
  bypasseó con SQL directo. Si vuelve a fallar la Admin API, revisar ese
  trigger).
