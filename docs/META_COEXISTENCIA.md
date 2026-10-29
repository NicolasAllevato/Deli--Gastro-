# Coexistencia: WhatsApp Business app + Cloud API

Permite que el local siga usando la app WhatsApp Business en el celular **y** que el bot (Worker
`workers/whatsapp-bot`) atienda por la Cloud API con el mismo número. Escrito con la documentación de Meta
que se conocía al momento; Meta cambia requisitos seguido: revisar la página oficial antes de ejecutar.
Lo marcado **verificar a mano** o **orientativo** no está confirmado.

## Qué hace el código (ya implementado)

- El webhook `POST /webhook` del Worker verifica la firma HMAC (`X-Hub-Signature-256`) y procesa, además de
  `messages`, los campos:
  - `smb_message_echoes`: mensaje que una persona escribió **desde la app** al cliente. Se guarda como saliente
    en `wa_messages`, **se pausa el bot en ese chat** y nunca se responde ni se apila como mensaje del cliente.
    - `image`, `video` y `document` se guardan con su tipo real y el cuerpo `[imagen]`, `[video]` o `[documento]`
      (nunca vacío), y también pausan. Otros tipos (sticker, ubicación, etc.) se guardan como `unsupported` y pausan.
    - `edit` y `revoke` modifican un mensaje anterior: **no** se guardan como mensaje nuevo ni pausan; solo se loguean.
    - Falla cerrado: sin `whatsapp_phone_number_id` configurado, con otro número, con destinatario de menos de
      8 dígitos o con fecha más de 5 minutos en el futuro, el eco se ignora y se loguea sin teléfonos ni textos.
      La fecha se acota a la hora actual; si no se puede leer se usa la hora actual (el eco no se descarta).
    - Un eco cuyo `wamid` ya está como saliente (reintento de Meta o mensaje que mandó el propio bot) se ignora:
      así no hay autopausa ni duplicados. Se guarda el eco y recién después se pausa.
    - Los ecos de OpenWA **no** pausan: OpenWA llega por otra vía (`src/lib/whatsapp/openwa.ts`), no por este webhook.
  - `history`: sincronización de historial. **Decisión:** se ignora de forma segura; solo se loguean conteos
    (fase, bloque, hilos, mensajes), nunca contenido. Si la persona rechazó compartir el historial, Meta manda
    `history[].errors[]` con el código 2593109 y sin hilos: se loguea "history rechazado por el usuario", distinto
    de un lote vacío. Guardarlo en `wa_messages` queda diferido (ver `docs/PENDIENTES.md`).
  - `smb_app_state_sync`: sincronización de contactos. **Decisión:** igual, solo se loguea la cantidad.
  - `account_update`: sin acciones. `PARTNER_REMOVED`, `ACCOUNT_OFFBOARDED` y `ACCOUNT_RECONNECTED` se registran
    como `ALERTA coexistencia` (solo el nombre del evento). **No** queda una fila en `global_config`: el rol
    `deli_bot` solo tiene `select` sobre esa tabla (migración 015) y no se amplían permisos por esto. La marca
    consultable es el log del Worker (Workers Observability, buscar `ALERTA coexistencia`).
  - Campos desconocidos o payload mal formado: se ignoran y se responde 200.
  - En un mismo payload los ecos se procesan antes que los mensajes, y los minutos de pausa se leen una sola vez.
- Pausa: `wa_conversations.bot_paused_until` (migración `021_bot_paused_until.sql`, **sin aplicar**). Dura
  `bot_human_takeover_minutes` desde la hora del eco (clave de `global_config`, 120 por defecto, máx. 7 días;
  valor inválido => 120). Un eco nunca acorta una pausa más larga. La pausa se suma a `human_takeover` (el del
  panel, que sigue siendo permanente hasta que se libere): el bot calla si cualquiera de los dos está activo, al
  recibir, al procesar el turno y de nuevo justo antes de enviar la respuesta (si un eco llega mientras el modelo
  piensa, no se envía nada).
- La conversación del eco se busca por los últimos 10 dígitos del teléfono (Argentina mezcla `549...` y `54...`);
  solo se crea una nueva si no hay ninguna. **Ojo:** el alta de mensajes entrantes sigue buscando por teléfono exacto.
- Panel (`/admin/conversaciones`): la lista y el encabezado muestran "Bot en pausa hasta HH:MM" aunque
  `human_takeover` sea false; "Devolver al agente" pone `human_takeover=false` y `bot_paused_until=null`.
  El agente de la app (`src/lib/agent/handler.ts`) y los endpoints `quote`/`confirm` de `src/lib/bot-internal`
  respetan la pausa. `status` y `cancel` siguen permitidos con una persona a cargo, como ya pasaba con `human_takeover`.
- **Decisión:** los mensajes que el cliente escribe durante la pausa se guardan (el panel los muestra) pero **no se
  reencolan** al terminar la pausa: el bot no contesta mensajes viejos; responde al próximo mensaje nuevo.
- Un eco a un contacto que nunca le escribió al bot crea la conversación. El panel va a mostrar esos chats; se
  distinguen porque `last_inbound_at` es nulo (van al final de la lista, igual que los chats que inicia el local, y
  el panel ya soporta ese caso).
- `GET /health` del Worker, además de `select 1`, comprueba que exista `wa_conversations.bot_paused_until`; si falta
  responde 503 con `{ ok: false, schema: false }`.

## Orden de despliegue

1. Aplicar `supabase/migrations/021_bot_paused_until.sql` (aditiva, columna nullable).
2. Recién después desplegar el Worker y la app (sus consultas leen la columna; sin ella fallan los mensajes).
3. `GET /health` debe dar `ok: true, schema: true`.

## Qué hace cada parte

| Paso | Quién |
|---|---|
| Actualizar la app WhatsApp Business a >= 2.24.17 | Usuario (celular del local) |
| Embedded Signup, escaneo de QR / código en el celular | Usuario |
| Elegir sincronizar contactos e historial | Usuario (en el flujo; ver abajo) |
| Suscribir webhooks, App Review, publicar la app, token de sistema, plantillas | Usuario en el panel de Meta |
| Aplicar migración 021 y desplegar el Worker | Usuario / quien despliega |
| Parseo, verificación de firma, pausa por eco, idempotencia | Código (este repo) |

## Pasos exactos

1. **Requisitos del número.** El número debe estar activo en la app WhatsApp Business (no la app personal)
   versión **2.24.17 o superior**, con uso reciente, en un país soportado. Un número ya registrado en la Cloud API
   por el camino normal no sirve: hay que partir de la app. La lista de países no soportados que circula es de
   terceros, **no oficial**: confirmar que Argentina entra viendo si el flujo de Embedded Signup ofrece el número.
   Prerrequisito de Solution Partner / Tech Provider: **verificar a mano** en la página oficial de onboarding de
   usuarios de la app WhatsApp Business si aplica a esta integración.
2. **Embedded Signup v5.** **v2 y v3 están deprecadas desde el 15-oct-2026.** El panel (`/admin/whatsapp`) llama
   `FB.login` con `extras: { version: "v5" }` (sin `setup`, `featureType` ni `sessionInfoVersion`: según la página de
   versiones de Meta, `sessionInfoVersion` ya no es un input y los productos salen de la *configuration*). En v5 el
   onboarding de la app WhatsApp Business (coexistencia) viene **activado por defecto**; con el interruptor
   «Coexistencia» apagado se manda además `features: [{ name: "whatsapp_business_app_onboarding", enabled: false }]`.
   El `config_id` (de Facebook Login for Business) se carga en el panel («Config ID»); no está en el código.
   Ver `buildSignupExtras` en `src/lib/whatsapp/embedded-signup.ts`.
   - En coexistencia el evento `postMessage` es `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` y, según la doc de Meta,
     trae **solo `waba_id`** (no `phone_number_id`). **No se pide PIN ni se registra el número** (ya está registrado).
     El servidor (`src/lib/whatsapp/signup-flow.ts`) canjea el `code` por el token, resuelve el `phone_number_id`
     con `GET /<WABA_ID>/phone_numbers` (**verificar** en vivo; si hay 0 o varios números responde 409 y se carga a
     mano), guarda token + ids y suscribe la app a la WABA (`POST /<WABA_ID>/subscribed_apps`; la doc de Meta no
     nombra este paso para coexistencia, se mantiene por compatibilidad: **verificar**).
   - Fuera de coexistencia (interruptor apagado) sigue el flujo estándar con PIN de 6 dígitos y registro.
3. **Escanear el código** que muestra el flujo con la app WhatsApp Business del celular y aceptar.
4. **Sincronizar contactos e historial: se decide en ese momento y debe hacerse dentro de las 24 h** del
   onboarding. Es **una sola vez por tipo**: si se rechaza o se deja vencer no se puede volver a pedir sin
   desvincular y repetir el onboarding. El historial llega por el campo `history` (lotes con fases) y los
   contactos por `smb_app_state_sync`; el Worker los registra (conteos) pero no los guarda.
5. **Webhooks a suscribir** en la app de Meta (producto WhatsApp > Configuración), apuntando a
   `https://<dominio-del-worker>/webhook` con el mismo *verify token* de `bot_secrets`:
   `messages`, `smb_message_echoes`, `history`, `smb_app_state_sync`, `account_update`.
   Además suscribir la app a la WABA del cliente (`POST /<WABA_ID>/subscribed_apps`).
6. **Qué se pierde / cambia al coexistir:**
   - No funcionan grupos ni llamadas (voz/video) desde la app; los mensajes temporales y "ver una vez" se desactivan.
   - Las **listas de difusión quedan en solo lectura**.
   - Se pierden también los mensajes de bienvenida y de ausencia, las respuestas rápidas, las etiquetas, el catálogo
     y los pedidos de la app, los estados, los canales y el perfil de negocio gestionado desde la app.
   - **WhatsApp para Windows y WearOS dejan de funcionar** con ese número.
   - **Inactividad:** si el dispositivo principal (el celular con la app) pasa ~14 días sin abrir la app, Meta
     desvincula la coexistencia; en un dispositivo acompañante el plazo es ~30 días.
   - **Límite fijo de 20 mensajes por segundo** (mps) por la Cloud API en coexistencia.
   - Los mensajes enviados desde la app **no abren ni extienden la ventana de 24 h** de la Cloud API: esa ventana
     solo la abre un mensaje del cliente.
7. **App Review:** pedir **Advanced Access** a `whatsapp_business_management` y `whatsapp_business_messaging`
   (necesario para atender a negocios que no son los de tu propio Business). Con video del flujo y *business
   verification* hecha. Luego **publicar la app** (modo Live); en modo desarrollo los webhooks de clientes reales
   no llegan. Verificación del negocio con una empresa unipersonal (orientativo, no confirmado por Meta): suele
   pedirse constancia de ARCA, DNI y comprobante de domicilio, y conviene un correo con dominio propio.
8. **Token de sistema** (usuario del sistema con acceso a la WABA, no el token temporal del Embedded Signup) y
   cargarlo en `bot_secrets.whatsapp_access_token` junto con `whatsapp_phone_number_id`, `whatsapp_app_secret`
   y `whatsapp_verify_token`. Sin `whatsapp_phone_number_id` el Worker ignora todos los ecos.
9. **Plantillas:** fuera de la ventana de 24 h solo se puede escribir con plantillas aprobadas; crearlas y
   aprobarlas antes (los mensajes enviados desde la app no tienen esa restricción, pero tampoco abren la ventana).
10. **OpenWA no coexiste.** OpenWA se vincula como dispositivo acompañante por QR y el onboarding de
    coexistencia **desvincula los dispositivos acompañantes**. Una vez activa la coexistencia hay que dejar de
    usar OpenWA con ese número (apagar `WHATSAPP_PROVIDER=openwa` y la sesión) o seguir con otro número de pruebas.
11. **Base y Worker:** ver "Orden de despliegue". Opcional: crear `bot_human_takeover_minutes` en `global_config`.

## Checklist de verificación

- [ ] App WhatsApp Business >= 2.24.17 y número activo en ella; Argentina aceptada por el flujo.
- [ ] Embedded Signup (v4+/v5) con `whatsapp_business_app_onboarding` y `config_id` correcto; QR aceptado.
- [ ] Contactos e historial sincronizados dentro de las 24 h (decisión tomada y registrada).
- [ ] Webhooks suscriptos: `messages`, `smb_message_echoes`, `history`, `smb_app_state_sync`, `account_update`.
- [ ] Migración 021 aplicada ANTES de desplegar; Worker desplegado; `GET /health` en `ok: true, schema: true`.
- [ ] Firma: un POST sin firma o con firma ajena devuelve 401.
- [ ] Prueba real: el cliente escribe -> el bot responde; el local responde desde la app -> aparece en
      `/admin/conversaciones` como saliente y el bot **calla** en ese chat ("Bot en pausa hasta HH:MM"); el cliente
      vuelve a escribir -> el bot sigue callado hasta cumplirse los minutos; en otro chat el bot sigue respondiendo.
- [ ] Reenviar el mismo eco (Meta reintenta) no duplica mensajes ni extiende la pausa.
- [ ] Editar o borrar un mensaje desde la app no pausa ni crea mensajes nuevos.
- [ ] En el log del Worker aparece `ALERTA coexistencia` si se desvincula o reconecta la cuenta.
- [ ] App Review aprobada, app publicada, token de sistema cargado, plantillas aprobadas.
- [ ] OpenWA apagado para este número.

## Multi-cliente (diseño propuesto, NO implementado)

### Cómo se guarda hoy (solo lectura)

- Un único negocio. Token, ids y secretos viven en `integration_secrets (key text pk, value text)` con RLS activada
  y sin políticas (solo el service role; migración 007). Claves: `whatsapp_access_token`, `whatsapp_phone_number_id`,
  `whatsapp_waba_id`, `whatsapp_app_secret`, `whatsapp_verify_token`, `whatsapp_app_id`, `whatsapp_config_id`
  (`src/lib/whatsapp/config.ts`; una variable de entorno `WHATSAPP_*` gana sobre la fila).
- `global_config` es de lectura pública por RLS: nunca lleva secretos (solo ajustes del bot como
  `bot_human_takeover_minutes`).
- El Worker (rol `deli_bot`, migración 015) no lee `integration_secrets`: la migración 016 le da la vista
  `bot_secrets` (`security_barrier`) con una lista fija de claves (`whatsapp_access_token`, `whatsapp_app_secret`,
  `whatsapp_verify_token`, `whatsapp_phone_number_id`, `mp_access_token`). **`whatsapp_waba_id` no está en la vista**:
  hoy el Worker no lo necesita. Todo es clave global: no hay forma de tener dos negocios.

### Diseño propuesto

Tabla nueva `public.tenant_whatsapp` (una fila por cliente/local):

| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid not null unique | negocio dueño (FK a la tabla de tenants que se cree; hoy no existe) |
| `phone_number_id` | text not null unique | clave de ruteo del webhook |
| `waba_id` | text not null | |
| `access_token_enc` | bytea not null | token cifrado (ver abajo) |
| `coexistence` | boolean not null default true | |
| `status` | text | `active` / `offboarded` (lo marca `account_update`) |
| `created_at`, `updated_at` | timestamptz | |

Secretos de la app de Meta (`app_secret`, `verify_token`, `app_id`, `config_id`) siguen **globales**: la app de Meta es
una sola (la del proveedor); solo el token, la WABA y el número son por cliente.

- **Cifrado:** el token se guarda cifrado con una clave maestra (secret del Worker y de la app, nunca en la base),
  por ejemplo AES-GCM con IV por fila. Alternativa: `pgsodium`/Vault de Supabase (**verificar** disponibilidad en el
  plan). Sin la clave maestra la fila no sirve.
- **RLS:** `enable row level security` sin políticas para `anon`/`authenticated`; el panel accede por service role
  filtrando por tenant. Si más adelante el dueño lee su propia fila, política `using (tenant_id = auth_tenant())` y
  solo columnas no secretas (vista sin `access_token_enc`).
- **Lectura desde el Worker:** el webhook de Meta trae `metadata.phone_number_id` (y `entry[].id` = WABA). El Worker
  busca la fila por `phone_number_id` (índice único), descifra el token en memoria y arma el cliente de ese tenant;
  un `phone_number_id` desconocido se ignora con 200 y log. Se expone a `deli_bot` una **vista**
  `bot_tenant_whatsapp (tenant_id, phone_number_id, waba_id, access_token_enc, status)` con `security_barrier` y
  `grant select` solo a `deli_bot`, igual que `bot_secrets` (migración 016). El descifrado ocurre en el Worker.
- **Caché:** `phone_number_id -> {token, tenant}` en memoria del isolate con TTL corto (60 s) para no consultar por
  cada mensaje; invalidar por TTL al rotar tokens.
- **Aislamiento de datos:** esto solo resuelve credenciales. `wa_conversations`, `orders`, `clients` y demás hoy no
  tienen `tenant_id`; multi-cliente real exige agregarlo a cada tabla y a sus políticas (trabajo mayor, fuera de
  este diseño).
- **Alta:** `completeSignup` (`signup-flow.ts`) recibiría el `tenant_id` del admin autenticado y haría `upsert` en
  `tenant_whatsapp` en vez de `saveWhatsAppSettings`. Token: el del canje de `code` es de negocio; para producción
  usar un token de usuario del sistema por cliente (**verificar** la política de Meta para tokens de Embedded Signup).
- **Migración de lo actual:** copiar las claves globales a una fila del primer tenant y dejar el fallback a las
  claves globales mientras exista un solo negocio.