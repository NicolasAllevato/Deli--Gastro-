# Coexistencia: WhatsApp Business app + Cloud API

Permite que el local siga usando la app WhatsApp Business en el celular **y** que el bot (Worker
`workers/whatsapp-bot`) atienda por la Cloud API con el mismo número. Verificado contra la documentación
de Meta al momento de escribir esto; Meta cambia requisitos seguido, revisar antes de ejecutar.

## Qué hace el código (ya implementado)

- El webhook `POST /webhook` del Worker verifica la firma HMAC (`X-Hub-Signature-256`) y procesa, además de
  `messages`, los campos:
  - `smb_message_echoes`: mensaje que una persona escribió **desde la app** al cliente. Se guarda como saliente
    en `wa_messages`, **se pausa el bot en ese chat** y nunca se responde ni se apila como mensaje del cliente.
  - `history`: sincronización de historial. **Decisión:** se ignora de forma segura; solo se loguean conteos
    (fase, bloque, hilos, mensajes), nunca contenido. Importarlo a `wa_messages` queda como mejora futura.
  - `smb_app_state_sync`: sincronización de contactos. **Decisión:** igual, solo se loguea la cantidad.
  - `account_update`: solo se loguea el nombre del evento, sin acciones.
  - Campos desconocidos o payload mal formado: se ignoran y se responde 200.
- Pausa: `wa_conversations.bot_paused_until` (migración `021_bot_paused_until.sql`, **sin aplicar**). Dura
  `bot_human_takeover_minutes` desde la hora del eco (clave de `global_config`, 120 por defecto, máx. 7 días;
  valor inválido => 120). Un eco nunca acorta una pausa más larga; ecos duplicados (mismo `wamid`) no cambian nada.
  La pausa se suma a `human_takeover` (el del panel, que sigue siendo permanente hasta que se libere): el bot calla
  si cualquiera de los dos está activo, tanto al recibir como al procesar el turno (cubre mensajes ya apilados).
- Fuera de alcance de este cambio: los endpoints de la app (`src/lib/agent/handler.ts`, `src/lib/bot-internal`)
  siguen leyendo solo `human_takeover`; el Worker ya corta antes, así que no se llega a ellos durante la pausa.

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
   por el camino normal no sirve: hay que partir de la app.
2. **Embedded Signup v4 o superior** con `featureType: "whatsapp_business_app_onboarding"` en la configuración
   de lanzamiento (`extras`). Se crea una *configuration* de Facebook Login for Business para esa variante;
   su **`config_id`** va en la llamada `FB.login`. Ver `src/lib/whatsapp/embedded-signup.ts` y
   `docs/META_REVISION_APP.md` para el flujo actual del repo y adaptarlo (hoy es el flujo estándar).
3. **Escanear el código** que muestra el flujo con la app WhatsApp Business del celular y aceptar.
4. **Sincronizar contactos e historial: se decide en ese momento y debe hacerse dentro de las 24 h** del
   onboarding. Es **una sola vez por tipo**: si se rechaza o se deja vencer no se puede volver a pedir sin
   desvincular y repetir el onboarding. El historial llega por el campo `history` (lotes con fases) y los
   contactos por `smb_app_state_sync`; el Worker los registra (conteos) pero no los guarda.
5. **Webhooks a suscribir** en la app de Meta (producto WhatsApp > Configuración), apuntando a
   `https://<dominio-del-worker>/webhook` con el mismo *verify token* de `bot_secrets`:
   `messages`, `smb_message_echoes`, `history`, `smb_app_state_sync`, `account_update`.
   Además suscribir la app a la WABA del cliente (`POST /<WABA_ID>/subscribed_apps`).
6. **Qué se pierde / cambia al coexistir:** no funcionan grupos, llamadas (voz/video) ni listas de difusión
   desde la app; los mensajes que desaparecen y "ver una vez" se desactivan; los chats siguen en el celular.
   Si el celular pasa ~14 días sin abrir la app, Meta desvincula la coexistencia.
7. **App Review:** pedir **Advanced Access** a `whatsapp_business_management` y `whatsapp_business_messaging`
   (necesario para atender a negocios que no son los de tu propio Business). Con video del flujo y *business
   verification* hecha. Luego **publicar la app** (modo Live); en modo desarrollo los webhooks de clientes reales
   no llegan.
8. **Token de sistema** (usuario del sistema con acceso a la WABA, no el token temporal del Embedded Signup) y
   cargarlo en `bot_secrets.whatsapp_access_token` junto con `whatsapp_phone_number_id`, `whatsapp_app_secret`
   y `whatsapp_verify_token`.
9. **Plantillas:** fuera de la ventana de 24 h solo se puede escribir con plantillas aprobadas; crearlas y
   aprobarlas antes (los mensajes enviados desde la app no tienen esa restricción).
10. **OpenWA no coexiste.** OpenWA se vincula como dispositivo acompañante por QR y el onboarding de
    coexistencia **desvincula los dispositivos acompañantes**. Una vez activa la coexistencia hay que dejar de
    usar OpenWA con ese número (apagar `WHATSAPP_PROVIDER=openwa` y la sesión) o seguir con otro número de pruebas.
11. **Base y Worker:** aplicar `supabase/migrations/021_bot_paused_until.sql` **antes** de desplegar el Worker
    (sus consultas leen la columna). Opcional: crear `bot_human_takeover_minutes` en `global_config`.

## Checklist de verificación

- [ ] App WhatsApp Business >= 2.24.17 y número activo en ella.
- [ ] Embedded Signup con `whatsapp_business_app_onboarding` y `config_id` correcto; QR aceptado.
- [ ] Contactos e historial sincronizados dentro de las 24 h (decisión tomada y registrada).
- [ ] Webhooks suscriptos: `messages`, `smb_message_echoes`, `history`, `smb_app_state_sync`, `account_update`.
- [ ] Migración 021 aplicada; Worker desplegado; `GET /health` en `ok: true`.
- [ ] Firma: un POST sin firma o con firma ajena devuelve 401.
- [ ] Prueba real: el cliente escribe -> el bot responde; el local responde desde la app -> aparece en
      `/admin/conversaciones` como saliente y el bot **calla** en ese chat; el cliente vuelve a escribir -> el bot
      sigue callado hasta cumplirse los minutos; en otro chat el bot sigue respondiendo.
- [ ] Reenviar el mismo eco (Meta reintenta) no duplica mensajes ni extiende la pausa.
- [ ] App Review aprobada, app publicada, token de sistema cargado, plantillas aprobadas.
- [ ] OpenWA apagado para este número.
