# Baja de cuentas de la app (personal y clientes)

Rama `feat/eliminacion-datos`. Producción corre en Cloudflare D1 con Better Auth (`DATA_BACKEND=d1`). Nada de esto está desplegado ni aplicado en remoto:
las migraciones se aplican con OK explícito del dueño (la 0019 ya está aplicada en staging; la 0020 y la 0021 son nuevas).

## Alcance (decisión del usuario, 2026-11-20)

- **Se eliminan cuentas de la app (filas de `user`)**: el personal del panel (dueño, gerente, cajero) y los **clientes**, estos últimos desde su propio panel
  (`/cliente/perfil` → Configuración de la cuenta → Dar de baja la cuenta). Los repartidores no pueden desde la aplicación.
- **Dar de baja una cuenta elimina únicamente su cuenta de acceso**: `user`, `session`, `account`, `verification` (por su email o su id) y sus intentos de contraseña.
  Ninguna otra tabla se toca: pedidos, clientes, puntos, reseñas, pagos, WhatsApp, reclamos, auditoría de Fudo y bitácoras quedan como están. No hay anonimización
  ni archivos de R2 (ese código se quitó; está en la historia de la rama).
- **Única escritura extra, solo para un CLIENTE**: su ficha (la atada por `clients.user_id`) queda dada de baja de comunicaciones: `clients.unsubscribed_at = ahora` y
  `wa_marketing_opt_in = 0`. La ficha NO se borra. El vínculo `user_id` pasa a NULL (trigger de la 0020). Nunca se expande por teléfono ni por email (ver "Seguridad").

## Hecho / falta

Hecho
- [x] Migración `0020`: trigger `BEFORE DELETE ON "user"` que desvincula la ficha de cliente antes de la cascada. Migración `0021`: `clients.unsubscribed_at TEXT` + índice parcial. (La 0019, `data_deletion_requests` y `legal_acceptances.user_id` nullable, ya estaba.)
- [x] `src/lib/data/data-deletion.ts`: lista, vista previa con código de un solo uso, ejecución del dueño, baja propia (personal y clientes), registro con HMAC, aviso por email.
- [x] API `/api/admin/eliminar-datos` (GET lista o email exacto, POST ejecuta), `/api/admin/eliminar-datos/vista-previa` (POST) y `/api/account/delete` (personal y clientes; repartidores 403).
- [x] Pantallas: `/admin/eliminar-datos` (solo dueño principal), "Mi cuenta" del panel, "Configuración de la cuenta" del perfil del cliente (modal con aviso destacado y casilla "Entiendo"), `/cuenta-eliminada`, `/eliminar-datos`.
- [x] Baja de comunicaciones respetada por campañas de WhatsApp y encuestas (ver la tabla de envíos), con filtros por ficha que fallan cerrado. BAJA / STOP / "no quiero recibir más" por WhatsApp marcan la baja de ese número verificado (Worker).
- [x] Aviso por email al terminar: el cliente recibe "tu cuenta fue dada de baja y no vas a recibir más promociones"; el personal, "tu cuenta fue eliminada".
- [x] `DATA_DELETION_HASH_SECRET` en `.env.example`; sin el secreto la eliminación queda deshabilitada (503 con mensaje claro).
- [x] Arreglo aparte: `/api/admin/legal` leía solo Supabase; ahora lee D1 con `DATA_BACKEND=d1`.

Falta (lo decide el dueño; con OK explícito, nada está aplicado ni desplegado)
- [ ] Desplegar según la sección "Para desplegar" (migraciones, secreto y Workers, en ese orden).
- [ ] Prueba en vivo con una cuenta de cliente y una de personal de prueba (el borrado de verdad solo se probó contra node:sqlite).
- [ ] Decidir qué hacer con el email, la IP y el navegador que conservan las constancias legales de una cuenta dada de baja (ver "Lo que se conserva").

## Para desplegar (en este orden)

1. **Migraciones D1** (base `deli-gastro`, `wrangler d1 migrations apply`): **0019** (si todavía no está en producción; ya está en staging), **0020** y **0021**. La 0021 tiene que estar aplicada ANTES de desplegar la app y el Worker (las consultas leen `clients.unsubscribed_at`).
2. **Secreto**: `DATA_DELETION_HASH_SECRET` en el Worker `opsyn-dely` (`wrangler secret put DATA_DELETION_HASH_SECRET --name opsyn-dely`, mínimo 32 caracteres, por ejemplo `openssl rand -hex 32`). Sin él la eliminación (herramienta y baja propia) queda deshabilitada con un 503. `SUPER_OWNER_EMAIL` ya existe de la entrega de usuarios.
3. **Workers**: **`opsyn-dely`** (la app: API, pantallas, campañas y encuestas) y **`whatsapp-bot`** (BAJA/STOP/"no quiero recibir más" marcan la baja del número verificado y ALTA la levanta; `workers/whatsapp-bot/src/repo/d1.ts` y `src/lib/whatsapp/keywords.ts`). No hay cambios en `encuestas-cron`, `fudo-gateway`, `pedidos-webhook`, `finanzas-sync` ni `uploads` (el cron de encuestas llama a la app).
4. Sin cambios de configuración: `wrangler.jsonc` no cambia (el binding `RECLAMOS` ya existente deja de usarse para borrar fotos, que ya no se borran).

## Cómo se usa

| Quién | Dónde | Cómo |
|---|---|---|
| Cliente | Mi perfil → Configuración de la cuenta → Dar de baja la cuenta | El modal aclara arriba y destacado qué implica (no vuelve a ingresar con esa cuenta, deja de recibir emails promocionales y mensajes de WhatsApp del local, se conserva el historial de pedidos por motivos contables y legales). El botón se habilita recién con la casilla "Entiendo", la contraseña actual (o el email exacto de la cuenta si no tiene contraseña) y escribir `ELIMINAR`. |
| Personal (dueño, gerente, cajero) | Panel → ícono "Mi cuenta" | Igual, con el aviso propio del personal. |
| Dueño principal (`SUPER_OWNER_EMAIL`) | Configuración → "Eliminar usuarios" | Elige a alguien del personal de la lista (o por email exacto) → vista previa → su contraseña y el email exacto del usuario → confirma. Solo personal: la herramienta no toca clientes. |

No se puede dar de baja: al dueño principal, al último dueño activo, a un repartidor (desde la app) ni a un cliente con un pedido en curso (recibido, en preparación o en camino) hasta que se entregue o cancele.
Otro dueño, un gerente o un cajero reciben 403 en la herramienta del panel (la ruta lo corta y la capa de datos lo vuelve a verificar contra la base). Si el aviso por email falla, solo se registra
y la baja sigue siendo válida (`notified: sent | failed | skipped`).

## Baja de comunicaciones: envíos encontrados y cómo quedó cada uno

`clients.unsubscribed_at` (NULL = recibe comunicaciones) es un freno que se suma a `wa_marketing_opt_in` (el opt-in a promociones, ALTA/BAJA por WhatsApp): con la baja no se manda nada promocional aunque el opt-in esté en 1.

| Envío | Qué es | Cómo elige destinatarios | Con la baja |
|---|---|---|---|
| Campañas de promociones por WhatsApp (`lib/whatsapp/campaigns.ts`, rutas `/api/whatsapp/campaigns` y `/preview`) | Promoción (plantilla `promocion`) | Clientes con `wa_marketing_opt_in = 1` y teléfono de su conversación de WhatsApp | **Respeta la baja de la ficha destinataria** al armar la lista (`resolveRecipients`) y otra vez justo antes de enviar (`runCampaign`). **Falla cerrado**: si la consulta da error se lanza y la campaña queda `failed` sin enviar nada; sin `IN` (D1 limita los parámetros): pide los dados de baja y cruza en memoria. |
| Encuestas de satisfacción (`sendDueSurveys`, cron `workers/encuestas-cron` → `/api/cron/surveys`) | Plantilla `encuesta_satisfaccion` por pedido entregado | Pedidos `Finalizados` sin reseña ni encuesta, con la conversación del cliente | **Respeta la baja de la ficha del pedido**: no se manda ni se reclama. Falla cerrado (error de lectura = falla, no envío). |
| Avisos de un pedido (`notifyOrderEvent`: confirmación, en preparación, en camino, entregado) | Transaccional | El cliente del pedido | **No aplica**: responden al pedido que él mismo hizo (y la baja se rechaza con un pedido en curso). |
| Respuestas del asistente y del Worker `whatsapp-bot`, respuestas manuales desde Conversaciones, aviso de resolución de un reclamo | Respuestas a un mensaje que el propio cliente inició | — | **No aplica**. El Worker no manda nada por iniciativa propia. |
| BAJA / ALTA entrantes por WhatsApp (Worker `whatsapp-bot`: `bot/turn.ts` → `repo/d1.ts`) | Consentimiento explícito del cliente | Mensaje que es exactamente `BAJA`, `STOP`, `dar de baja`, `no quiero más promos/promociones/mensajes` o `no quiero recibir más [promos/promociones/mensajes]` (sin tildes ni signos), o `ALTA` | El número del remitente ya está verificado por Meta: BAJA marca `unsubscribed_at` y `wa_marketing_opt_in = 0` en las fichas con ESE teléfono exacto y le confirma con un mensaje; ALTA los levanta. Repetir la BAJA no cambia la fecha. |
| Resumen diario (`lib/daily-summary/send.ts`) y aviso de reclamos (`lib/reclamos/notify.ts`) | Email y WhatsApp al personal | Los destinatarios que el local cargó en Configuración | **No aplica**: no leen la tabla de clientes (una prueba lo verifica). |
| Emails | Recuperación de contraseña, aviso de baja, resumen y reclamos | — | **No existe ningún email promocional a clientes** hoy. Si se agrega, tiene que respetar `unsubscribed_at` (hay un helper por ficha en `campaigns.ts`). |

## Seguridad de la confirmación (herramienta del dueño principal)

1. **Vista previa → código.** Devuelve un código de un solo uso: `<vencimiento>.<nonce>.<HMAC-SHA256>`, vence a los 5 minutos y está atado al dueño y al usuario elegido. Un usuario protegido no recibe código.
2. **Ejecución.** Exige el código, la contraseña del dueño (hasher real de Better Auth) y el email exacto del usuario. 5 contraseñas incorrectas en 15 minutos bloquean 30 (clave propia en `courier_pin_attempts`).
3. **Un solo uso.** El código se consume (`bot_nonces`, prefijo `deletion:`) recién cuando todo lo demás está en orden.
4. **Secreto.** `DATA_DELETION_HASH_SECRET` firma el código y hace el `subject_hash` (HMAC-SHA256 de `subject:email:<email normalizado>`). Sin secreto (o con menos de 32 caracteres) todo queda deshabilitado.
5. **Registro** (`data_deletion_requests`): hash, canal (`admin` o `autoservicio`), fechas, quién lo hizo, conteos y estado. Nunca el email.
6. **Atomicidad.** El borrado y el cierre del registro van en un solo `batch` con guardas en el mismo SQL (`json('x')` revierte todo si el último dueño activo cambia justo antes). El `DELETE` del usuario solo toca `role` admin o cliente.

Baja propia (personal y clientes): contraseña actual o, si la cuenta no tiene (entró con otro proveedor), el email exacto de la cuenta; más `ELIMINAR` y el mismo tope de intentos.

**La baja de comunicaciones nunca expande por teléfono ni por email, ni al dar la baja ni al enviar.** Solo se da de baja la ficha con `clients.user_id` = la cuenta que se da de baja, y cada envío promocional se saltea cuando la ficha
destinataria de ESE envío (la del pedido, o la del cliente elegido en la campaña) tiene `unsubscribed_at`; nunca se mira otra ficha alcanzada por teléfono. El teléfono que un cliente carga en su perfil no está verificado, y `wa_conversations.client_id`
se vincula comparando con esos teléfonos: si se usaran para dar de baja a otras fichas, alguien podría escribir el número de otra persona, darse de baja y dejarla sin comunicaciones (hay pruebas de esto: la ficha de A con el teléfono de V se da de baja y
a V las campañas y encuestas le siguen llegando). Lo mismo vale para el bloqueo por pedido en curso. Limitación conocida: la baja de la cuenta de un cliente no frena el WhatsApp de una ficha ajena con su mismo número; para eso el cliente
escribe BAJA desde su WhatsApp (el número lo verifica Meta) y el Worker marca la baja en las fichas con ese teléfono exacto.

## Claves foráneas a `"user"` (revisadas)

| Tabla.columna | `ON DELETE` | Qué pasa al dar de baja una cuenta |
|---|---|---|
| `session.userId`, `account.userId` | CASCADE | Es la cuenta de acceso: se borra (a propósito). |
| `legal_acceptances.user_id` | SET NULL (0019) | La constancia se conserva sin usuario. |
| `orders.courier_user_id` | SET NULL | El pedido se conserva (queda `courier_name`). |
| `clients.user_id` | CASCADE | **Historial** (la ficha y, por cascada, puntos, reseñas y pagos). Lo cubre el trigger de la 0020: desvincula la ficha (`user_id = NULL`) antes de la cascada. |
| `couriers`, `courier_locations`, `courier_shifts` (`user_id`) | CASCADE | Son de repartidores: el `DELETE` solo toca `role` admin o cliente, así que no se tocan. |

No se pasó `clients.user_id` a SET NULL reconstruyendo la tabla: SQLite no cambia una clave foránea sin reconstruir, y reconstruir `clients` con la clave foránea activa (D1 no deja apagarla) dispararía las cascadas de sus hijos.
Una prueba lista todas las claves foráneas a `user` y falla si aparece una nueva.

## Lo que se conserva

Todo lo que no es la cuenta de acceso:
- Pedidos (con sus datos de entrega), fichas de cliente (la del cliente dado de baja queda con `unsubscribed_at` y sin cuenta vinculada), puntos, reseñas, pagos, conversaciones, reclamos, `fudo_writes` y bitácoras.
- `legal_acceptances`: la fila queda con `user_id` NULL **pero conserva `email`, `ip` y `user_agent`** de la aceptación (decisión del usuario: "se conserva"). Si se quiere que no queden, es un `UPDATE` más en el lote.
- Referencias por id huérfanas, sin datos personales: `fudo_writes.actor` (`admin:<id>`), `integration_settings.updated_by`.
- El Panel de control de OPSYN recibió una copia de cada aceptación legal (email, IP, navegador): no hay forma de borrarla desde acá. El proyecto Supabase anterior al corte también conserva una copia de las tablas de la app.

## Pruebas

- `tests/data-deletion.test.ts` (D1 real con node:sqlite y Better Auth real): hash HMAC y secreto, código (vigencia, atado, un solo uso), lista y búsqueda exacta, permisos (403 para todo el que no es el dueño principal), vista previa, ejecución,
  registro sin datos en claro, aviso por email, contraseña y bloqueo, guarda atómica, protecciones, **el historial no cambia ni una fila** (comparación de todas las tablas), trigger de la 0020, revisión de claves foráneas, baja del personal y
  **baja de un cliente** (con contraseña, sin contraseña con email exacto, tope de intentos, pedido en curso, ficha de baja, **dos fichas con el mismo teléfono de cuentas distintas: la de B no se modifica**).
- `tests/clients-baja-envios.test.ts`: cada envío con D1 real y Meta simulado (campañas: selección, reenvío, falla cerrado, más de 90 destinatarios con bajas repartidas; encuestas; avisos de pedido; **A con el teléfono de V se da de baja y a V le siguen llegando campañas y encuestas**; **BAJA entrante: ese número deja de recibir**; ALTA).
- `tests/data-deletion-api.test.ts`: validación con zod, 400/403/404/409/503, clientes y repartidores, cookies y los dos emails de aviso. `tests/legal-admin-list.test.ts`, `tests/permissions.test.ts`, `tests/origin-guard-coverage.test.ts`, `tests/data-guard.test.ts`.
