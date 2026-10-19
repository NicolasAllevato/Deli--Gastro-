---
name: whatsapp-vinculacion-meta
description: Vincular, revisar o reparar el número de WhatsApp (Cloud API de Meta) de Deli-Gastro. Usar cuando el usuario pida conectar WhatsApp, cambiar de número, rotar el token, cuando no lleguen o no salgan mensajes, cuando falle el webhook o haya que subir la versión de la Graph API.
---

# Vinculación de WhatsApp con Meta (Deli-Gastro)

Conexión directa a la **WhatsApp Cloud API** (sin BSP ni n8n). Pantalla: `/admin/whatsapp`.

## Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| Pantalla de vinculación | `src/app/admin/whatsapp/page.tsx` |
| Guardar/leer credenciales | `src/app/api/whatsapp/config/route.ts` → `src/lib/whatsapp/config.ts` |
| Revisión (número, WABA, suscripción) | `src/app/api/whatsapp/test/route.ts` → `src/lib/whatsapp/diagnose.ts` |
| Registrar número / suscribir app | `src/app/api/whatsapp/link/route.ts` |
| Cliente Graph API (versión en `GRAPH_URL`) | `src/lib/whatsapp/client.ts` |
| Webhook de Meta (sin sesión, firma HMAC) | `src/app/api/whatsapp/webhook/route.ts` |
| Tests | `tests/whatsapp.test.ts`, `tests/whatsapp-diagnose.test.ts` |
| Doc general del agente | `docs/WHATSAPP_AGENTE.md` |

## Dónde se guarda la configuración

Tabla `integration_secrets` en Supabase (proyecto `Delivery`, id `wlznhichyivfcqwbosyi`; el proyecto
es compartido con otro sistema: no tocar tablas ajenas). Claves:

| Campo | Clave en `integration_secrets` | Variable de entorno (gana sobre la tabla) |
|---|---|---|
| Token permanente | `whatsapp_access_token` | `WHATSAPP_ACCESS_TOKEN` |
| Phone Number ID | `whatsapp_phone_number_id` | `WHATSAPP_PHONE_NUMBER_ID` |
| WABA ID | `whatsapp_waba_id` | `WHATSAPP_WABA_ID` |
| App Secret | `whatsapp_app_secret` | `WHATSAPP_APP_SECRET` |
| Token de verificación | `whatsapp_verify_token` | `WHATSAPP_VERIFY_TOKEN` |

Para ver qué hay cargado **sin exponer secretos**:

```sql
select key, length(value) as largo, updated_at
from integration_secrets where key like 'whatsapp%' order by key;
```

Nunca imprimir ni pegar en el chat el valor del token o del App Secret.

## Conexión con Facebook (Embedded Signup) — camino recomendado

Botón «Conectar con Facebook» en `/admin/whatsapp` (`EmbeddedSignup.tsx` → `POST /api/whatsapp/embedded-signup`).
El servidor canjea el código (`exchangeCodeForToken`), guarda token + Phone Number ID + WABA, registra el número con el PIN y suscribe la app.

Requisitos en la app de Meta (una sola vez):
1. Caso de uso WhatsApp, tipo Business. Copiar **App ID** y **App Secret** (Configuración → Básica).
2. Producto **Facebook Login for Business**: «Login con SDK de JavaScript» = Sí y dominio de la app en «Dominios permitidos para el SDK». Meta exige HTTPS: no funciona desde `http://localhost`.
3. Crear una configuración de tipo **WhatsApp Embedded Signup** (permisos `whatsapp_business_management` y `whatsapp_business_messaging`) y copiar el **Config ID**.
4. Cargar App ID, Config ID y App Secret en «Credenciales» (claves `whatsapp_app_id`, `whatsapp_config_id`, `whatsapp_app_secret`).
5. Webhook: URL `https://DOMINIO/api/whatsapp/webhook` + token de verificación, campo `messages`.

Cabeceras: `next.config.ts` permite `connect.facebook.net` y `*.facebook.com` en la CSP y usa COOP `same-origin-allow-popups` (con `same-origin` el popup de login no puede devolver el resultado).
En modo desarrollo de la app solo funcionan usuarios con rol en la app; para clientes reales hace falta verificación del negocio y App Review.

## Paso a paso manual (alternativa: lo que hace el dueño en Meta + la app)

1. **App** en Meta for Developers con el producto WhatsApp, asociada al Meta Business del local.
2. **Pago**: tarjeta en WhatsApp Manager (Meta cobra los mensajes al dueño).
3. **Número**: agregarlo y verificarlo (SMS/llamada). Activar la **verificación en dos pasos** y anotar el **PIN de 6 dígitos**. El número no puede estar en uso en la app de WhatsApp común.
4. **Token permanente**: Configuración del negocio → Usuarios del sistema → crear uno, **asignarle la app y la cuenta de WhatsApp (WABA)**, generar token con `whatsapp_business_messaging` y `whatsapp_business_management`. (El token temporal del panel vence en 24 h: no usarlo.)
5. En `/admin/whatsapp` cargar Phone Number ID, WABA ID, token y App Secret (Configuración de la app → Básica). Generar el token de verificación y **Guardar**.
6. En Meta → WhatsApp → Configuración: URL `https://DOMINIO/api/whatsapp/webhook`, el token de verificación, y suscribir el campo **messages**. Solo HTTPS público (en local, túnel con cloudflared).
7. En `/admin/whatsapp` → "Vinculación con Meta":
   - **Registrar número** con el PIN (`POST /{PHONE_NUMBER_ID}/register`). Una sola vez por número.
   - **Suscribir app** (`POST /{WABA_ID}/subscribed_apps`).
   - **Revisar vinculación**: número, cuenta y suscripción tienen que quedar en verde.
8. Plantillas en `/admin/plantillas` → "Crear en Meta" (incluida `resumen_diario`). Quedan PENDING hasta que Meta las apruebe.

## Errores frecuentes

| Síntoma | Causa | Arreglo |
|---|---|---|
| Meta no verifica el webhook | Token de verificación distinto, URL sin HTTPS o el GET da 403 | Copiar el token tal cual desde la pantalla; probar `GET /api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=X&hub.challenge=1` |
| Webhook verificado pero no llegan mensajes | App sin suscribir a la WABA | "Suscribir app" y revisar |
| Llegan POST con 401 | App Secret equivocado (firma HMAC no coincide) | Recargar el App Secret de la app correcta |
| POST con 403 "Webhook not configured" | Falta App Secret | Cargarlo |
| Error al enviar: número no registrado | Falta `register` | "Registrar número" con el PIN |
| Error 190 / token inválido | Token temporal vencido o revocado | Token permanente de usuario del sistema |
| "WABA inexistente" / permisos | WABA ID equivocado o el usuario del sistema no tiene asignada la cuenta | Revisar el ID y la asignación de activos |
| Texto libre no se entrega | Fuera de la ventana de 24 h del cliente | Usar plantilla aprobada |
| Calidad YELLOW/RED | Reportes/bloqueos de clientes | Bajar frecuencia de campañas |

## Versión de la Graph API

`GRAPH_URL` en `src/lib/whatsapp/client.ts` usa **v26.0** (vigente desde julio 2026; v21.0 se da de baja el 21/01/2027).
Para subirla: verificar en https://developers.facebook.com/docs/graph-api/changelog/versions/,
cambiar la constante y el test "usa la versión ... de la Graph API" en `tests/whatsapp.test.ts`, correr `npm test`.

## Modo demo

En `npm run demo` / `demo:rapido` el cliente es simulado (`createDemoClient` en `config.ts`): no sale a
internet, la suscripción vive en memoria y la revisión da verde una vez suscrita.

## Verificación después de tocar algo

```bash
npx tsc --noEmit && npm test && npx eslint src/app/admin/whatsapp src/app/api/whatsapp src/lib/whatsapp
```
