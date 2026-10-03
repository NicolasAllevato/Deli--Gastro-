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
- [ ] Registro de clientes: crear la fila en `clients` al darse de alta un usuario.
- [ ] Crear usuarios admin y repartidor con `app_metadata.role`.
- [ ] Geocodificación de direcciones reales (hoy hay 5 zonas de ejemplo).
- [ ] Notificaciones y asistente por n8n (hoy simulados).
- [ ] Reemplazar polling por Supabase Realtime.
- [ ] Tests (unitarios, integración, E2E) y cobertura.
- [ ] Decisiones abiertas de producto: ver `docs/FLUJO_PEDIDO.md` §8.

## Manuales (bloquean a Claude, requieren dashboard/CLI del usuario)

- [ ] **R2 API keys**: generar en Dashboard Cloudflare → R2 → Manage R2 API
      Tokens → permiso Object Read & Write, bucket `deli-gastro-productos`.
      Completar `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` en `.env.local`
      (y en Vercel). Sin esto, `/api/upload` no puede escribir a R2.
      Ver `docs/CLOUDFLARE_SETUP.md`.
- [ ] **Deployar Workers** (`pedidos-webhook`, `finanzas-sync`): correr
      `npx wrangler secret put ...` + `npx wrangler deploy` en cada carpeta
      de `workers/`. Código ya listo, no deployado.
- [ ] **Leaked Password Protection** (Supabase Auth): activar en Dashboard
      → Authentication → Policies. Es config de servicio, no SQL.
- [ ] **npm audit**: 6 advisories high (post `npm install @aws-sdk/client-s3`),
      requieren bump mayor Next.js 16.2.9 → 16.3.3+. No se hizo en este pase
      por riesgo de romper otros cambios en curso — evaluar en un PR aparte.

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
