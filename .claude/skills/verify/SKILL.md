---
name: verify
description: Cómo levantar Deli-Gastro en local y manejar los flujos de WhatsApp/OpenWA para verificar cambios en vivo.
---

# Verificar Deli-Gastro en vivo

## Levantar
- `npm run dev` → http://localhost:5178 (Turbopack; tarda ~20 s en estar listo en esta PC).
- Si el puerto 5178 queda tomado por un `node` huérfano (EADDRINUSE): cerrarlo con `taskkill /PID <pid> /T /F`.
- Login: `admin.prueba@deligastro.test` (credenciales en el TXT de usuarios de prueba, gitignored). El modo demo usa una base en memoria e ignora OpenWA.

## WhatsApp por OpenWA (canal QR de pruebas)
- Variables en `.env.local`: `WHATSAPP_PROVIDER=openwa`, `OPENWA_URL`, `OPENWA_API_KEY`, `OPENWA_SESSION_ID`, `OPENWA_WEBHOOK_SECRET`. Cargarlas con `set -a; . ./.env.local; set +a` y nunca imprimirlas.
- Estado de la sesión: `GET $OPENWA_URL/api/sessions/$OPENWA_SESSION_ID` (header `X-API-Key`). Historial: `GET /api/audit?limit=N`.
- Simular un evento sin teléfono: POST a `http://localhost:5178/api/whatsapp/openwa/webhook` con el header `X-OpenWA-Signature: sha256=<HMAC del body con OPENWA_WEBHOOK_SECRET>`. Eventos: `message.received`, `message.sent`, `message.ack`.
- Para eventos reales de OpenWA hace falta el túnel `cloudflared tunnel --url http://localhost:5178` y volver a registrar el webhook con la URL nueva (DELETE del viejo, POST del nuevo con secret y events, y `POST .../webhooks/<id>/test` → 200).
- Revisar lo guardado: tablas `wa_conversations` y `wa_messages` (proyecto Supabase `wlznhichyivfcqwbosyi`). Usar wamids `VERIFY…` y un teléfono falso (`5490000000099`), y borrarlos al terminar.

## Gotchas
- La vista Conversaciones refresca sola y reactiva la sesión de OpenWA como mucho una vez por minuto: un `stop` manual se revierte en ≤1 min si la vista está abierta.
- Enviar desde Conversaciones manda un WhatsApp real: solo hacerlo hacia el teléfono de prueba del usuario y con su permiso.
