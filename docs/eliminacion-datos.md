# Eliminación de usuarios de la app

Rama `feat/eliminacion-datos`. Producción corre en Cloudflare D1 con Better Auth (`DATA_BACKEND=d1`). Nada de esto está desplegado ni aplicado en remoto:
las migraciones se aplican con OK explícito del dueño (la 0019 ya está aplicada en staging; la 0020 es nueva).

## Alcance (decisión del usuario, 2026-11-20)

- **Solo se eliminan USUARIOS de la app**: filas de `user`, o sea el personal del panel (dueño, gerente, cajero). Los clientes **no** pueden eliminar su cuenta desde
  la aplicación: piden la baja por email a `BRAND.contactEmail` (30 días, la atiende el local a mano; esta herramienta no los toca). Los repartidores tampoco.
- **Borrar un usuario elimina únicamente su cuenta de acceso**: `user`, `session`, `account`, `verification` (por su email o su id) y sus intentos de contraseña.
  Ninguna otra tabla se toca: pedidos, clientes, puntos, reseñas, pagos, WhatsApp, reclamos, auditoría de Fudo y bitácoras quedan como están. No hay anonimización
  ni archivos de R2 en esta entrega (se quitó todo ese código; está en la historia de la rama).

## Hecho / falta

Hecho
- [x] Migración `0020_user_delete_conserva_historial.sql`: trigger `BEFORE DELETE ON "user"` que desvincula la ficha de cliente (ver "Claves foráneas"). La 0019 (tabla
      `data_deletion_requests` y `legal_acceptances.user_id` nullable con `ON DELETE SET NULL`) ya estaba en la rama y en staging.
- [x] `src/lib/data/data-deletion.ts` (389 líneas): lista, vista previa con código de un solo uso, ejecución del dueño, autoservicio, registro con HMAC, aviso por email.
- [x] API `/api/admin/eliminar-datos` (GET lista o email exacto, POST ejecuta), `/api/admin/eliminar-datos/vista-previa` (POST) y `/api/account/delete` (solo personal).
- [x] Pantalla `/admin/eliminar-datos` (solo dueño principal), "Mi cuenta" (`/admin/mi-cuenta`), `/cuenta-eliminada`, `/eliminar-datos` actualizada. El botón salió del perfil del cliente.
- [x] `DATA_DELETION_HASH_SECRET` en `.env.example`; sin el secreto la eliminación queda deshabilitada (503 con mensaje claro).
- [x] Arreglo aparte: `/api/admin/legal` leía solo Supabase; ahora lee D1 con `DATA_BACKEND=d1`.
- [x] Pruebas (ver al final).

Falta (lo decide el dueño)
- [ ] Definir el secreto en el Worker: `wrangler secret put DATA_DELETION_HASH_SECRET --name opsyn-dely` (mínimo 32 caracteres, por ejemplo `openssl rand -hex 32`).
- [ ] Aplicar la 0020 en la D1 remota (`wrangler d1 migrations apply`, con OK) y desplegar la app.
- [ ] Prueba en vivo con un usuario de prueba (el borrado de verdad solo se probó contra node:sqlite).
- [ ] Decidir si `BRAND.legalUpdated` se actualiza por el cambio en `/eliminar-datos`.
- [ ] Decidir qué hacer con el email, la IP y el navegador que conservan las constancias legales de un usuario eliminado (ver "Lo que se conserva").

## Cómo se usa

| Quién | Dónde | Cómo |
|---|---|---|
| Dueño principal (`SUPER_OWNER_EMAIL`) | Configuración → "Eliminar datos" | Elige a un usuario de la lista (o lo busca por email exacto) → vista previa (nombre, email, rol, qué se borra con conteos, qué se conserva) → ingresa SU contraseña y escribe el email exacto del usuario → confirma. |
| Personal (dueño, gerente, cajero) | Panel → ícono "Mi cuenta" | Contraseña actual + escribir `ELIMINAR`. Borra al instante, cierra la sesión y redirige a `/cuenta-eliminada`. |
| Clientes | Email a `BRAND.contactEmail` | Lo atiende el local a mano (30 días). Sin botón en la aplicación. |

No se puede eliminar al dueño principal ni al último dueño activo. Otro dueño, un gerente o un cajero reciben 403 en la herramienta del panel (la ruta lo corta y la capa
de datos lo vuelve a verificar contra la base). Al terminar se manda un email "tu cuenta fue eliminada" al usuario con el sistema de correo existente; si falla, solo se
registra y el borrado sigue siendo válido (`notified: sent | failed | skipped`).

## Seguridad de la confirmación (herramienta del dueño principal)

1. **Vista previa → código.** `POST /api/admin/eliminar-datos/vista-previa` devuelve un código de un solo uso: `<vencimiento>.<nonce>.<HMAC-SHA256>`, vence a los 5 minutos y está atado
   al dueño que lo pidió y al id del usuario elegido. Un usuario protegido no recibe código.
2. **Ejecución.** Exige el código, la contraseña del dueño (verificada con el hasher real de Better Auth) y el email exacto del usuario (sin importar mayúsculas ni espacios).
   Tras 5 contraseñas incorrectas en 15 minutos se bloquea 30 (clave propia en `courier_pin_attempts`; no toca el tope global del PIN).
3. **Un solo uso.** El código se consume (`bot_nonces`, prefijo `deletion:`) recién cuando todo lo demás está en orden: una contraseña mal puesta no lo quema, y reutilizarlo después de borrar falla (409).
4. **Secreto.** `DATA_DELETION_HASH_SECRET` firma el código y hace el `subject_hash` del registro: HMAC-SHA256 de `subject:email:<email normalizado>` (no un sha256 a secas). Sin secreto (o con menos de
   32 caracteres) la herramienta y el autoservicio quedan deshabilitados.
5. **Registro** (`data_deletion_requests`): hash, canal (`admin` o `autoservicio`), fechas, quién lo hizo, conteos y estado. Nunca el email. La lista del panel no muestra ni el hash ni quién lo hizo.
6. **Atomicidad y protecciones.** El borrado y el cierre del registro van en un solo `batch`. El lote lleva guardas dentro del mismo SQL (`SELECT json(CASE ... 'x' ...)` falla con "malformed JSON" y revierte
   todo): si entre la verificación y el lote el dueño principal deja de estar activo, no se aplica nada y el sistema no se queda sin dueño. El `DELETE` del usuario lleva `role = 'admin'`.

Autoservicio: contraseña actual + `ELIMINAR` + el mismo tope de intentos. Clientes y repartidores reciben 403 (también en el GET de elegibilidad). El dueño principal y el último dueño activo, también.

## Claves foráneas a `"user"` (revisadas)

| Tabla.columna | `ON DELETE` | Qué pasa al borrar un usuario del personal |
|---|---|---|
| `session.userId`, `account.userId` | CASCADE | Es la cuenta de acceso: se borra (a propósito). |
| `legal_acceptances.user_id` | SET NULL (0019) | La constancia se conserva sin usuario. |
| `orders.courier_user_id` | SET NULL | El pedido se conserva (queda `courier_name`). |
| `clients.user_id` | CASCADE | **Historial** (la ficha y, por cascada, puntos, reseñas y pagos). Lo cubre el trigger de la 0020: desvincula la ficha (`user_id = NULL`) antes de la cascada. |
| `couriers`, `courier_locations`, `courier_shifts` (`user_id`) | CASCADE | Son de repartidores: la herramienta solo borra `role = 'admin'`, así que no se tocan. |

No se pasó `clients.user_id` a SET NULL reconstruyendo la tabla: SQLite no cambia una clave foránea sin reconstruir, y reconstruir `clients` con la clave foránea activa (D1 no deja apagarla) dispararía las
cascadas de sus hijos (puntos, reseñas, pagos). Una prueba lista todas las claves foráneas a `user` y falla si aparece una nueva, para decidir qué hacer con ella.

## Lo que se conserva

Todo lo que no es la cuenta de acceso. En particular:
- Pedidos (con sus datos de entrega), fichas de cliente, puntos, reseñas, pagos, conversaciones y reclamos, `fudo_writes` y bitácoras. Si el usuario del personal también había comprado, su ficha de cliente queda sin cuenta vinculada.
- `legal_acceptances`: la fila queda con `user_id` NULL **pero conserva `email`, `ip` y `user_agent`** de la aceptación (decisión del usuario: "se conserva"). Si se quiere que no queden, es un `UPDATE` más en el lote.
- Referencias por id que quedan huérfanas, sin datos personales: `fudo_writes.actor` (`admin:<id>`), `integration_settings.updated_by`.
- Ajustes del local con datos del personal (destinatarios del resumen diario, quién conectó WhatsApp): los edita el dueño.
- El Panel de control de OPSYN recibió una copia de cada aceptación legal (email, IP, navegador): no hay forma de borrarla desde acá. El proyecto Supabase anterior al corte también conserva una copia de las tablas de la app.

## Pruebas

- `tests/data-deletion.test.ts` (D1 real con node:sqlite y Better Auth real): hash HMAC y secreto (sin secreto, 503 y nada cambia), código (vigencia, atado a dueño y usuario, alterado, un solo uso, vencido), lista y búsqueda exacta,
  permisos (otro dueño, gerente, cajero, cliente, repartidor, anónimo, sistema: 403), vista previa, ejecución (qué se borra y qué no), registro sin datos en claro, aviso por email (enviado, fallido, omitido),
  contraseña y bloqueo, email exacto, guarda atómica, protecciones, **el historial no cambia ni una fila** (comparación de todas las tablas antes y después), trigger de la 0020, revisión de claves foráneas y autoservicio.
- `tests/data-deletion-api.test.ts`: validación con zod, 400/403/404/409/503, contrato de la respuesta, clientes y repartidores 403, cookies y email de aviso.
- `tests/legal-admin-list.test.ts`: lectura D1 de `/admin/legal`. `tests/permissions.test.ts`, `tests/origin-guard-coverage.test.ts`, `tests/data-guard.test.ts`: permisos, CSRF y SQL parametrizado.
