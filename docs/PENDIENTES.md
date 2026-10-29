# Pendientes — Deli-Gastro

## Estado al 2026-10-29 (lo vigente; lo de abajo es historial y puede estar desactualizado)

En producción (`dely.opsyn.app`): PRs #6 a #12 fusionados. El ingreso de repartidores con PIN anda
(probado el 2026-10-28 con claves de Supabase sin BOM y redeploy). El PR #13 (redirect sin `/api` en
307, `cleanEnv` unificado, `trim` en los Workers) está abierto.

**Hecho (no repetir):** migraciones 001–020 aplicadas, salvo comprobar la 011 (la memoria dice que se
aplicó el 2026-10-19; verificar con `select name from supabase_migrations.schema_migrations` y los
triggers `wa_*_notify_changed`). Cobro con Mercado Pago (código), Conversaciones sobre OpenWA, app
Android del repartidor (APK firmada v2, en `public/descargas/`), gateway Fudo (código).

**Pendiente, por orden:**
1. **Usuario:** instalar la APK en el Samsung. Causas probables del bloqueo: "Instalar apps
   desconocidas" para el navegador, Auto Blocker (Ajustes > Seguridad y privacidad > Auto Blocker,
   desactivar "Bloquear instalaciones no autorizadas") y Play Protect ("Instalar de todos modos").
2. **Vercel (faltan, el código las lee):** `CRON_SECRET` (sin ella los dos crons dan 401),
   `UPLOADS_WORKER_URL` y `UPLOADS_WORKER_TOKEN`, `MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET`/`PUBLIC_URL`,
   `RESEND_API_KEY` y remitente, `WHATSAPP_*`, `OPENAI_API_KEY`. Confirmar que `NEXT_PUBLIC_APP_URL`
   valga `https://dely.opsyn.app`. `NEXT_PUBLIC_DEMO_MODE` no debe estar definida (hoy no lo está).
3. **`encuestas-cron`:** generar `CRON_SECRET`, cargarlo igual en Vercel y en el Worker, `BASE_URL` =
   `https://dely.opsyn.app`, `wrangler secret bulk` y `wrangler deploy` (cuenta Proyectos OPSYN).
4. **Fudo** (mail de solicitud enviado, falta el `Fudo-Integrator-Token`): crear un KV propio (los
   `FUDO_KV` de esa cuenta son del CRM de Frankie, no tocar), poner su id y el `account_id` correcto en
   `workers/fudo-gateway/wrangler.toml`, cargar secretos y desplegar; construir la pantalla admin de
   mapeo de productos y medios de pago. Cargar `FUDO_GATEWAY_URL`/`FUDO_GATEWAY_SECRET` en Vercel **al
   final**, porque desde ahí cada pedido intenta sincronizar.
5. **PIN de repartidores:** son 4 dígitos con tope global de 60 intentos por 15 min. Decidir: 6 dígitos,
   o PIN más identificador, o atar el PIN a dispositivos. Definir `COURIER_PIN_SECRET` propio obliga a
   regenerar todos los PIN.
6. **Meta / bot de WhatsApp (al final):** webhook de Meta a `bot-dely.opsyn.app/webhook`, fase 5
   (tomador de pedidos), publicar la app, número real con coexistencia, rotar los secretos que
   pasaron por el chat (`deli_bot`, Meta, Cloudflare) y las claves de Supabase de `datos.txt`.
7. **Menores:** decidir los canales privados de la 011; Leaked Password Protection; pasar el redirect a
   `permanent: true` cuando todo esté estable; `.gitattributes` con `*.gradle text eol=lf` para el ruido
   de fin de línea de `cap sync`.

---

## Historial (estado al 2026-10-12, rama `feat/demo-local`)

El trabajo de esa fecha ya está commiteado y fusionado a `main`.

## Actualización 2026-10-21: OpenWA y Conversaciones (rama `feat/conversaciones-openwa`, sin push)

Hecho: evaluación de [OpenWA](https://github.com/rmyndharis/OpenWA) (MIT, NestJS). La vista de
Conversaciones quedó rediseñada con su interfaz de chat portada (commit `0c008bf`): búsqueda, filtros,
separadores por día, formato de WhatsApp, estados de entrega y bloqueo de la respuesta fuera de la
ventana de 24 h. Clon de evaluación en `Desktop\Proyectos\openwa-eval`. Plan completo en
`~/.claude/plans/gh-repo-clone-rmyndharis-openwa-dynamic-goose.md`.

Para la próxima sesión, en orden:
1. **Usuario:** desplegar OpenWA en EasyPanel siguiendo `Desktop\OpenWA en EasyPanel - pasos rapidos.txt`.
   Pasar el dominio y la API key (de `/app/data/.api-key`). Solo un número descartable por QR.
2. Push de `feat/conversaciones-openwa` y PR.
3. Recorrer el panel y el Swagger de OpenWA con la sesión de prueba. Decidir si se despliega como canal
   o si solo se usa su interfaz.
4. Fase 1: motor `MetaCloudPlugin` (IWhatsAppEngine sobre la Cloud API) para que cada local conecte su
   número por Meta. Reutiliza la firma, el cliente Graph y el parseo del Worker `whatsapp-bot`.
5. Guardas de los límites de Meta: contador de mensajes iniciados por día con alerta al 80 % y breaker
   por los códigos 131048/130429. Leer `quality_rating` en el diagnóstico.
6. La vista muestra la ventana de 24 h con `lastInboundAt` de la lista. Si esa lista no cargó, el composer
   queda bloqueado: agregar `lastInboundAt` a la respuesta de `/api/whatsapp/conversations/[id]`.
7. El demo no tiene conversaciones de ejemplo: sembrar `wa_conversations`/`wa_messages` en `src/lib/demo/seed.ts`.
8. Decidir dónde hospedar OpenWA en producción y su costo mensual. Docker Desktop no corre en esta PC
   ("Windows hypervisor is not running").

## Actualización 2026-10-16 (rama `feat/demo-local`, 3 commits locales sin push)

Hecho: migración 012 aplicada; canje de puntos → carrito (con devolución al cancelar); cobro con Mercado Pago
(`docs/MERCADOPAGO.md`); tema claro beige y animaciones.

Para la próxima sesión, en orden:
1. ~~Migración 013~~ APLICADA 2026-10-16. Queda la **011** (decidir si los canales son privados).
2. Probar Mercado Pago en sandbox: cargar `MP_ACCESS_TOKEN` (TEST-), `MP_WEBHOOK_SECRET` y `PUBLIC_URL`.
3. Correr la suite E2E completa tras el tema beige y las animaciones.
4. Revisar el modo claro en el resto de pantallas (repartidor, login, landing, ejecutivo, mapa, mobile).
5. Coexistencia de WhatsApp y App ID/config_id de Meta.
6. Operativos: uploads en Vercel, claves OpenAI/Meta, `encuestas-cron`, Leaked Password Protection.
7. Mercado Pago, decisiones abiertas: cuotas, facturación AFIP, reembolsos parciales, limpieza de intenciones vencidas.

## Lo que queda, en orden (estado al 2026-10-12)

**Necesita una decisión del usuario**
1. **Migración `011_realtime_pings_whatsapp.sql`: escrita, SIN aplicar** al proyecto `Delivery`.
   Hasta aplicarla, conversaciones y campañas se actualizan cada 30 s en producción (antes 5 s).
   Antes de aplicarla conviene decidir si los tres canales (`wa_conversations`,
   `wa_conversation:<id>`, `wa_campaigns`) pasan a ser privados: hoy son públicos como los de la
   010, así que cualquiera con la anon key puede ver *cuándo* hay movimiento (sin datos) y
   forzar refetch del panel. Son solo de admin, no hay motivo funcional para que sean públicos.
2. `finanzas-sync` agrupa por día UTC: el "día" corta a las 21:00 de Argentina. Sin cambiar.

**Por parte de Claude (cuando haya con qué)**
1. Desplegar `workers/encuestas-cron` (listo, con tests): falta una URL pública https sin SSO
   (`BASE_URL`) y un `CRON_SECRET` igual en la app y en el Worker.
2. Probar WhatsApp y el agente con claves reales: checklist de 12 pasos en `docs/WHATSAPP_AGENTE.md`.
3. Encuestas: los pedidos de clientes que nunca escribieron por WhatsApp se vuelven a evaluar en
   cada corrida durante la ventana y ocupan lugar en el lote de 50. Filtrarlos por SQL.
4. Tope global diario de gasto de IA (hoy el tope es por conversación: 12/min y 300/día).
5. Registro de auditoría de la exportación de clientes (quién y cuándo bajó teléfonos y direcciones).
6. Tests de los módulos de I/O sin cobertura (`whatsapp/{campaigns,inbound,pipeline}`,
   `agent/{handler,reply,tools}`, `reports/data.ts`) y pinear por SHA las acciones del CI.
   El CI (`.github/workflows/ci.yml`) todavía no corrió en un runner real.

**Por parte del usuario (dashboard o CLI propio)**
1. Cargar `UPLOADS_WORKER_URL` y `UPLOADS_WORKER_TOKEN` en Vercel (valores de `.env.local`).
   Las R2 API keys ya no hacen falta.
2. Claves reales: `OPENAI_API_KEY` y las de Meta (`WHATSAPP_ACCESS_TOKEN`,
   `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`)
   y aprobación de las plantillas.
3. Activar Leaked Password Protection (último, a pedido del usuario).
4. Decidir quién va a llamar a `pedidos-webhook` y entregarle el `WEBHOOK_SECRET` de `.env.local`.

## Resuelto el 2026-10-12

- **Exportación de clientes** (`GET /api/admin/clients/export`, botón en `admin/informes`): CSV con
  datos de contacto, nivel, puntos, pedidos, cancelados, gasto, ticket promedio, primer y último
  pedido, días de inactividad y producto más pedido. Pedidos/gasto/ticket son del período elegido;
  primer/último pedido e inactividad son siempre históricos. Falla con error en vez de truncar.
- **Usuarios de prueba** reales (admin, 2 clientes, repartidor) creados con la Admin API; datos en
  `usuarios-de-prueba.txt` (raíz, ignorado por git). El repartidor que faltaba ya existe.
- **Realtime** en conversaciones, campañas y tablero ejecutivo (este último no se actualizaba
  solo). `src/lib/live-channel.ts` comparte un canal por topic: antes, pasar de una pantalla a otra
  con el mismo topic dejaba a la segunda sin avisos. Verificado en navegador contra Supabase real.
- **`finanzas-sync`** solo escribía la primera corrida de cada día (faltaba `on_conflict=report_date`).
  Arreglado y re-desplegado; la corrida siguiente actualizó la fila.
- **Uploads por Cloudflare**: Worker `uploads` con binding R2 (sin R2 API keys), desplegado y
  probado de punta a punta. `/api/upload` lo usa si están sus dos variables.
- **Encuestas**: ya no se pueden enviar dos veces por corridas solapadas, solo salen de 9 a 22 hs,
  un error de base ya no se informa como "0 enviadas" y un pedido no queda reclamado sin encuesta.
- **Agente**: máximo 8 herramientas por turno, tope de 12/min y 300/día por conversación (se calla
  si no puede contar) y los errores internos ya no llegan al cliente.
- **Tests**: 301 unitarios (98,5 % de líneas sobre lo cargado, `npm run coverage`), E2E de reseñas,
  canje de puntos y cancelación, y CI en GitHub Actions.

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
- [ ] El proyecto Supabase `Delivery` se pausa solo por inactividad. Si el MCP da timeout o
      ECONNREFUSED: `get_project` → `INACTIVE` → `restore_project` y esperar a que responda el 5432.
      En producción real conviene un plan que no se pause.

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
  `⚠️ OBSOLETO`. La fuente de verdad es `supabase/migrations/` (001 a 010, todas
  aplicadas al proyecto `Delivery`), confirmada contra el schema real vía
  introspección y `list_tables`.
- Admin (`admin@deli-gastro.com`) reparado: rol movido de `user_metadata` a
  `app_metadata` directo en `auth.users` (la Admin API de GoTrue devolvía
  "Database error finding users" al listar usuarios — posible trigger
  `on_auth_user_created` del otro subsistema; no investigado a fondo, se
  bypasseó con SQL directo. Si vuelve a fallar la Admin API, revisar ese
  trigger).
