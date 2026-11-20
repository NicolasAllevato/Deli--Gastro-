# Eliminación de datos personales

Entrega 1 de la rama `feat/eliminacion-datos`. Producción corre en Cloudflare D1 con Better Auth (`DATA_BACKEND=d1`). Nada de esto
está aplicado ni desplegado: la migración `0019` se aplica con OK explícito del dueño.

## Hecho / falta

Hecho

- [x] Inventario de datos personales de todas las tablas (este documento y `src/lib/data/data-deletion-inventory.ts`).
- [x] Migración `d1/migrations/0019_eliminacion_datos.sql`: tabla `data_deletion_requests` y reconstrucción de `legal_acceptances`
      (`user_id` admite NULL con `ON DELETE SET NULL`, para que la constancia sobreviva a la baja).
- [x] Módulo de borrado `src/lib/data/data-deletion.ts` (previsualizar, ejecutar en un `batch` atómico, registrar, R2, idempotente) y su
      envoltorio `data-deletion-app.ts`.
- [x] API `/api/admin/eliminar-datos` (solo dueño principal) y `/api/account/delete` (autoservicio, con contraseña).
- [x] Permisos: `/admin/eliminar-datos` y su API en OWNER_ONLY, `guardSuperOwner` y verificación contra la base en la capa de datos;
      `/admin/mi-cuenta` abierta a todo el personal.
- [x] Pestaña "Eliminar datos" en Configuración (solo dueño principal) y página `/admin/eliminar-datos`.
- [x] Botón "Eliminar cuenta" en el perfil del cliente y en "Mi cuenta" del panel (ícono en la barra superior), con Modal accesible.
- [x] Páginas `/eliminar-datos` (completa) y `/cuenta-eliminada`; enlace "Eliminación de datos" en el pie del sitio.
- [x] Arreglo aparte: `/api/admin/legal` leía solo Supabase; ahora lee D1 con `DATA_BACKEND=d1`.
- [x] Corrección de seguridad: resolución de identidad en un solo salto + confirmación de ids cuando hay más de una cuenta o ficha (`matchedBy`, `via`).
- [x] Pruebas: `tests/data-deletion.test.ts`, `tests/data-deletion-api.test.ts`, `tests/legal-admin-list.test.ts` y casos nuevos en
      `tests/permissions.test.ts`.

Falta (lo decide el dueño u otra entrega)

- [ ] Aplicar `0019` en la D1 remota (`wrangler d1 migrations apply`, con OK) y definir `SUPER_OWNER_EMAIL` (ya existe de la entrega de usuarios).
- [ ] Desplegar la app. Hasta entonces la migración no tiene que estar aplicada: nada del código nuevo corre.
- [ ] Prueba en vivo con una cuenta de prueba (el borrado de verdad solo se probó contra node:sqlite).
- [ ] Copias fuera de D1 (sección "Lo que esta herramienta no alcanza"): Supabase anterior al corte, Panel de control de OPSYN, Fudo, Meta.
- [ ] Decidir si la fecha "Última actualización" de las páginas legales (`BRAND.legalUpdated`) se actualiza por el cambio en `/eliminar-datos`.
- [ ] Si se quiere que el borrado impida que Fudo reimporte al mismo cliente: lista de supresión con `subject_hash` (no incluida).

## Cómo se usa

| Canal | Quién | Cómo |
|---|---|---|
| Autoservicio | Cliente o personal del local (dueño, gerente, cajero) | Perfil del cliente → "Eliminar cuenta"; panel → ícono "Mi cuenta". Pide la contraseña actual y escribir `ELIMINAR`. Borra al instante, cierra la sesión y redirige a `/cuenta-eliminada`. |
| Email / WhatsApp | El dueño principal | Configuración → "Eliminar datos": buscar por teléfono o email, revisar qué coincidió (y elegir cuáles si son varias) y el conteo por tabla, escribir `ELIMINAR`. Antes hay que verificar la identidad por fuera (que escriba desde el email de su cuenta o desde el teléfono). Canal registrado: `email` u `admin`. |

No pueden eliminar su cuenta desde la aplicación: repartidores (lo pide el local), el dueño principal (`SUPER_OWNER_EMAIL`) y el último dueño
activo. Tampoco mientras haya un pedido en curso (recibido, en preparación o en camino). La herramienta del panel solo la usa el dueño
principal: otro dueño, un gerente o un cajero reciben 403 (la ruta lo corta y la capa de datos lo vuelve a verificar contra la base).

## Qué se hace con cada dato

`delete` = se borra la fila. `anonymize` = la fila se conserva y se vacían las columnas personales. `keep` = no se toca (razón en la tabla).

| Tabla | Datos personales | Acción |
|---|---|---|
| `user` | name, email, image, phone | delete |
| `session` | ipAddress, userAgent, token | delete |
| `account` | accountId, accessToken, refreshToken, idToken, password (hash) | delete |
| `verification` | identifier (email), value (id de usuario o token) | delete |
| `clients` | name, phone, phone_digits, address, email | delete (los clientes anónimos por canal, no) |
| `points_ledger` | description | delete |
| `reviews` | feedback | delete |
| `payment_intents` | snapshot (carrito con dirección y notas), checkout_url, ids de Mercado Pago | delete |
| `orders` | customer_name, delivery_address, delivery_lat/lng, delivered_lat/lng/accuracy_m, notes, courier_name | anonymize: quedan id, fechas, montos, medio de pago, estado y canal; `client_id` pasa a NULL |
| `order_items` | fudo_comment | anonymize: quedan producto, cantidad y precio |
| `order_events` | detail (solo el evento `assigned` lleva el nombre del repartidor) | anonymize |
| `fudo_writes` | payload (nombre, teléfono, dirección y comentario enviados a Fudo), actor (id de usuario) | anonymize |
| `couriers` | name, pin_hash, pin_encrypted | delete |
| `courier_locations` | courier_name, lat, lng, accuracy_m, heading, speed_mps | delete |
| `courier_shifts` | courier_name | delete |
| `legal_acceptances` | user_id, email, ip, user_agent | anonymize: queda documento, versión, fecha y rol |
| `wa_conversations` | client_phone, contact_name, state (borrador de pedido con dirección) | delete |
| `wa_messages` | body (texto, transcripción de audios, ubicación) | delete |
| `kb_analisis_conversaciones` | conversation_id | delete |
| `reclamos` | client_phone, client_id, conversation_id, motivo, foto_keys, notas, resolucion, mensaje_resolucion, sugerencia y sus errores | anonymize: quedan número, categoría, estado, `order_id` y compensación |
| `reclamos_eventos` | detalle | anonymize (queda tipo, autor y fecha) |
| `integration_settings` | updated_by (id del usuario del panel) | anonymize |
| Archivos R2 (`deli-gastro-reclamos`) | fotos del reclamo (`reclamos.foto_keys`) | delete, mejor esfuerzo |
| `rateLimit`, `courier_pin_attempts` | key con IP / dispositivo | keep: sin vínculo con una persona, se renuevan por ventana |
| `kb_errores`, `kb_sugerencias` | texto de conversaciones reales | keep: el Worker enmascara teléfonos, emails, direcciones y nombres antes de guardar (`maskTranscriptPii`) y no guarda vínculo con la conversación |
| `wa_turn_replies`, `bot_nonces`, `wa_campaigns`, `kb_negocio`, catálogo, carta, zonas, reportes, mapeos Fudo, `live_versions`, `_migracion` | sin datos personales | none |
| `global_config` | destinatarios del resumen diario (nombre, email, teléfono del personal), teléfonos de prueba del bot | keep: configuración del local, la edita el dueño |
| `data_deletion_requests` | solo hash | keep |

Los audios de WhatsApp no se guardan como archivo: se transcriben y solo queda el texto en `wa_messages.body`.

## Reglas y decisiones

- **Quién es el sujeto: un solo salto desde el dato ingresado.** Se busca SOLO con el email normalizado o los últimos dígitos del teléfono (mínimo 8) que
  se escribió: las cuentas (`user`) y fichas (`clients`) que tienen EXACTAMENTE ese dato. No se agregan los otros teléfonos o emails de lo encontrado para
  seguir buscando: quien cargó el mismo teléfono o email que otra persona no arrastra sus datos (antes la búsqueda se expandía en cadena usuario → teléfono →
  ficha → email → otra cuenta; está corregido y con pruebas). Lo único que se sigue son vínculos por id: las fichas de una cuenta, la cuenta de una ficha,
  y las conversaciones y reclamos de esas fichas, más las del teléfono exacto ingresado (ese número de WhatsApp lo verifica Meta).
- **Más de una coincidencia exige confirmar ids.** Si la previsualización encuentra más de una cuenta o más de una ficha (`requiresConfirmation`), la ejecución se
  rechaza (409) salvo que el pedido traiga `confirmedUserIds` / `confirmedClientIds`, y esas listas tienen que ser un subconjunto de lo previsualizado (otro id, aunque
  exista, se rechaza). Solo se borra lo confirmado; las fichas de una cuenta confirmada van con ella (por la clave foránea se borrarían igual, sin anonimizar sus
  pedidos). Cada coincidencia indica `matchedBy` (`email` o `phone`), `via` (`direct`: tiene ese dato; `link`: cuelga por id), un nombre abreviado ("Marta G.") y, en las
  cuentas, `blockedReason` si es el dueño principal o el último dueño activo. Los conteos de la previsualización son de todas las coincidencias. Tope: más de 10 fichas
  se frena (un dato genérico, como el teléfono del local, no puede arrastrar a decenas de clientes). La pantalla muestra las casillas vacías a propósito.
- **Autoservicio: el sujeto es siempre la sesión propia** (su `user_id` y sus fichas por `clients.user_id`, con las conversaciones y reclamos vinculados a esas fichas por
  `client_id`). El teléfono y el email que cargó el usuario no están verificados: si se usaran para buscar, alguien podría cargar el dato de otra persona y borrarle sus
  conversaciones y pedidos. El email de la cuenta solo se usa para borrar sus propios tokens y para el hash del registro. Lo que quede por teléfono se pide por email
  (la página lo explica).
- **Pedidos anonimizados, no borrados**: la obligación contable pide conservar el pedido. Se conserva `id`, fechas, `total_cents`, `delivery_fee_cents`,
  medio de pago, estado y canal. Dirección y ubicación pasan a NULL (no a "Eliminado") para que el reintento de geocodificación de Fudo no
  intente ubicar un texto inventado; el nombre pasa a "Eliminado".
- **Pagos**: las intenciones de pago se borran (llevan el carrito con dirección y notas). El pago real queda en Mercado Pago y el pedido conserva monto y medio.
- **Constancia legal**: la migración 0019 vuelve `legal_acceptances.user_id` nullable con `ON DELETE SET NULL`; al eliminar, la fila queda sin usuario,
  email, IP ni navegador. `/admin/legal` no lista las filas con `user_id` NULL.
- **Protecciones**: nunca se elimina al dueño principal ni al último dueño activo. Además de la verificación previa, el lote lleva guardas dentro del
  mismo SQL (`SELECT json(CASE ... 'x' ...)`: falla con "malformed JSON" y revierte todo), así que una carrera entre dos pedidos no deja al sistema sin dueño.
- **Atomicidad e idempotencia**: borrado, anonimización y cierre del registro van en un solo `batch`. Lo ya borrado no se vuelve a encontrar: repetir devuelve
  `found: false` y queda registrado igual.
- **Registro** (`data_deletion_requests`): `subject_hash` = sha256 de `phone:<últimos 10 dígitos>` o `email:<email normalizado>` (o `user:<id>`), canal, fechas,
  `performed_by`, conteos en JSON, estado y error. Nunca el dato en claro. La lista del panel no muestra ni el hash ni quién lo hizo.
  Aviso: un sha256 de un teléfono se puede recuperar por fuerza bruta (el espacio es chico); si eso importa, el hash debería ser un HMAC con un secreto.
- **Archivos (R2)**: se borran antes del lote (si el lote falla y se reintenta, borrar de nuevo es inofensivo) y solo claves `reclamos/<id>/<archivo>`. Si alguna
  falla, o no hay binding, el estado es `partial` y `error` lista las claves para limpiarlas a mano. El binding `RECLAMOS` ya está en `wrangler.jsonc` de la app.
- **Autoservicio**: verifica la contraseña con el hasher real de Better Auth; tras 5 contraseñas incorrectas en 15 minutos bloquea 30 (clave propia en
  `courier_pin_attempts`, no toca el tope global del PIN). La ruta vence las cookies de sesión de Better Auth.
- **Pedidos en curso**: bloquean el autoservicio (borrar la dirección a mitad de la entrega la rompería). En la herramienta del panel solo avisan.

## Lo que esta herramienta no alcanza

1. **Supabase**: el corte a D1 dejó una copia anterior de las tablas de la app en el proyecto Supabase (clientes, pedidos, WhatsApp, etc.). La herramienta
   no la toca. Hay que borrarla o archivarla al dar de baja Supabase; mientras exista, contiene datos personales de antes del corte.
2. **Panel de control de OPSYN**: cada aceptación legal se copia allá (`usuario_id`, email, IP, user agent; `src/lib/legal/panel.ts`). No hay endpoint de borrado.
3. **Fudo**: el sistema del local guarda clientes y ventas. `clients.fudo_customer_id` se borra, pero el dato en Fudo no. Si Fudo vuelve a informar la venta o el cliente,
   la sincronización podría recrearlos o volver a escribir el nombre y la dirección sobre un pedido ya anonimizado (no se verificó el detalle del sync de ventas y
   clientes del Worker `fudo-gateway`, que figura apagado). No hay lista de supresión.
4. **Meta / WhatsApp, Mercado Pago, OpenAI**: cada uno conserva lo suyo según su política (OpenAI procesa los mensajes del asistente).
5. **Ajustes del local** (`global_config`, `integration_settings`): destinatarios del resumen diario, teléfonos de prueba del bot y quién conectó WhatsApp
   (nombre y email de Facebook, cifrado) los edita el dueño; no se limpian automáticamente cuando alguien del personal se elimina.
6. **Registros de Workers** (observabilidad) y el buffer transitorio del Durable Object `ConversationBuffer`: caducan solos.

## Pruebas

- `tests/data-deletion.test.ts` (node:sqlite con el esquema real y Better Auth real): inventario completo contra el esquema (una tabla nueva sin clasificar rompe la prueba),
  cada columna del inventario sembrada con un marcador y comprobada antes y después, escaneo de TODAS las columnas de todas las tablas, previsualización, ejecución, pedidos
  anonimizados con montos intactos, idempotencia, controles que no cambian, R2, repartidor, guarda atómica, permisos, protecciones y autoservicio (contraseña, bloqueo, ámbito).
- `tests/data-deletion-api.test.ts`: validación zod, 400/403, canal, confirmación y cookies.
- `tests/legal-admin-list.test.ts`: lectura D1 de `/admin/legal`.
- `tests/permissions.test.ts`, `tests/origin-guard-coverage.test.ts`, `tests/data-guard.test.ts`: permisos, CSRF y SQL parametrizado.
