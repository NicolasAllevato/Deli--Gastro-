# Revisión de la app Meta "Opsyn Dely" (1655370112887275)

Objetivo: acceso avanzado a `whatsapp_business_messaging` y `whatsapp_business_management` (requisito de Tech Provider, necesario para la coexistencia). Meta revisa en inglés: pegar el bloque en inglés en cada permiso.

Datos útiles para el formulario:
- App: Opsyn Dely · URL: https://opsyndely.la-gambeta.com
- Número de prueba de Meta para los videos: +1 555-195-8047 (WABA de prueba 908165765681683, phone_number_id 1174731025734369)
- Usuario de prueba para el revisor: crear un admin de prueba en la app y poner las credenciales en "Instrucciones para el revisor" (no van en este archivo).

---

## whatsapp_business_messaging

**Descripción (pegar):**

Opsyn Dely is an ordering and operations platform for restaurants. Each restaurant connects its own WhatsApp Business number through Embedded Signup (including WhatsApp Business app coexistence, so the owner keeps using the app on the phone).

We use whatsapp_business_messaging to:
1. Receive messages from the restaurant's customers through our webhook and answer them with an ordering assistant (menu questions, prices, building an order, delivery address confirmation). Human staff can take over any conversation from our admin panel.
2. Send order status notifications using approved utility templates: order confirmation, in preparation, on the way, delivered, and a satisfaction survey.
3. Send the restaurant owner a daily summary template.

Messages are only sent to customers who contacted the restaurant first or who placed an order and gave their number. We never send marketing without opt-in.

**Video 1 (qué mostrar, 1–2 min, sin cortes):**
1. Login en Opsyn Dely → /admin/whatsapp, mostrar el número conectado (+1 555-195-8047).
2. Desde un celular con WhatsApp mandar "hola" al número de prueba.
3. Mostrar en la app (Conversaciones) el mensaje recibido y la respuesta del asistente.
4. Mostrar en el celular la respuesta llegando.
5. Disparar un estado de pedido (p. ej. "En camino") y mostrar la plantilla llegando al celular.

---

## whatsapp_business_management

**Descripción (pegar):**

We use whatsapp_business_management to let each restaurant manage its WhatsApp Business assets from the Opsyn Dely admin panel after connecting through Embedded Signup:
1. Read the WhatsApp Business Account and its phone numbers to show the connection status.
2. Register the phone number and subscribe our app to the account's webhooks so incoming messages reach the ordering assistant.
3. Create and list message templates (order confirmation, in preparation, on the way, delivered, satisfaction survey, daily summary) and show their approval status in the panel.

We only access the WhatsApp Business Accounts that the restaurant explicitly shares with us during Embedded Signup.

**Video 2 (qué mostrar):**
1. Login → /admin/whatsapp → sección de plantillas.
2. Crear una plantilla nueva (categoría UTILITY) desde la app.
3. Mostrar que aparece en la lista con estado "En revisión"/"PENDING" (y si se puede, también en el WhatsApp Manager de Meta).

---

## business_management

**Descripción (pegar):**

Required by Embedded Signup and Tech Provider onboarding: we read the business portfolio that the restaurant selects during signup in order to find the WhatsApp Business Account it shared with our app. We do not manage ads, pages or other assets.

---

## email / public_profile

**Descripción (pegar):**

Used only by Facebook Login for Business during Embedded Signup to identify the admin who connects the restaurant's WhatsApp account. We store the name and email to show who connected the account in our admin panel.

---

## Checklist antes de enviar
- [ ] Configuración básica: ícono 1024×1024, URL de política de privacidad, URL de condiciones, categoría, correo de contacto.
- [ ] Número de prueba conectado en la app (para los videos).
- [ ] Video 1 y video 2 grabados (.mp4).
- [ ] Usuario de prueba para el revisor.
- [ ] Envío final: lo confirma el usuario.
