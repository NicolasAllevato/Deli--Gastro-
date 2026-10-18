# Revisión de la app de Meta — Opsyn Dely Agente

App ID `1655370112887275` · portfolio OPSYN soluciones inteligentes (`1751120339216553`).
Textos listos para pegar en **Revisión de la app → Solicitudes** y guion de los videos.

## Antes de enviar

| Requisito | Estado |
|---|---|
| Ícono 512×512 | Cargado |
| Categoría | Mensajes |
| Política de privacidad | `/privacidad` (cargada con la URL del túnel: actualizar al dominio) |
| Condiciones del servicio | `/terminos` (ídem) |
| Instrucciones de eliminación de datos | `/eliminar-datos` (cargar con el dominio definitivo) |
| Dominio de la app y del SDK de JS | Pendiente: dominio propio (Meta no guarda `trycloudflare.com`) |
| Verificación del negocio | La inicia el dueño en Business Manager → Centro de seguridad |
| Verificación de acceso (proveedor de tecnología) | Después de la del negocio |
| Usuario de prueba para los revisores | Admin de prueba en `/admin` + número de prueba de Meta |

Meta revisa la app completa: todas las URL tienen que abrir sin login y con HTTPS.

## Textos por permiso

### whatsapp_business_messaging
Opsyn Dely es un sistema de pedidos para restaurantes. Usamos este permiso para que el asistente del
restaurante responda por WhatsApp los mensajes que le escriben sus clientes: muestra el menú, cotiza el
pedido con precios y costo de envío, lo confirma y avisa los cambios de estado (en cocina, en camino,
entregado). También envía plantillas aprobadas de confirmación y una encuesta de satisfacción después de
la entrega. Solo se envían promociones a quienes escribieron ALTA, y BAJA las desactiva.

### whatsapp_business_management
Lo usamos para que el dueño del restaurante conecte su número desde nuestro panel: leemos el número y
la cuenta de WhatsApp Business que eligió en el registro insertado, suscribimos la app a esa cuenta
para recibir los mensajes en nuestro webhook, registramos el número en la Cloud API y creamos y
consultamos el estado de sus plantillas de mensajes (confirmación, seguimiento, encuesta y promociones).

### whatsapp_business_manage_events
Lo usamos para registrar en la cuenta del restaurante los eventos de conversión de los pedidos que se
cierran por WhatsApp (pedido confirmado y entregado), para que el dueño mida qué conversaciones terminan
en una venta.
> Si no se va a usar medición de conversiones, **eliminar este permiso** de la solicitud antes de enviar.

### business_management
Necesario para el registro insertado (Embedded Signup): el dueño elige o crea su portfolio comercial y
su cuenta de WhatsApp Business al iniciar sesión con Facebook desde nuestro panel, y nuestra app accede
solo a los activos que él compartió para administrar el número del restaurante.

### manage_app_solution
Lo usamos como proveedor de tecnología para administrar la solución de WhatsApp de cada restaurante que
se conecta a Opsyn Dely por el registro insertado.
> Solo hace falta si se usa el modelo de socio de soluciones; si no, eliminarlo de la solicitud.

### public_profile
Mostramos el nombre de la persona que conectó la cuenta de WhatsApp en el panel del restaurante, para
que el equipo sepa quién hizo la vinculación.

### email
Guardamos el email de quien conectó la cuenta para avisarle si la conexión falla, si el token deja de
ser válido o si Meta cambia el estado de calidad del número.

## Guion de los videos (un video sirve para varios permisos)

Grabar en 1080p, con el idioma en inglés o con subtítulos en inglés (Meta lo pide), sin cortes en el
login. Duración: 2 a 4 minutos.

### Video 1 — Conexión del número (whatsapp_business_management, business_management, public_profile, email, manage_app_solution)
1. Abrir `https://DOMINIO/login` e iniciar sesión como admin del restaurante.
2. Ir a **WhatsApp** en el menú y mostrar la pantalla vacía (sin número conectado).
3. Escribir un PIN de 6 dígitos y tocar **Conectar con Facebook**.
4. En el popup de Meta: iniciar sesión, mostrar la pantalla de permisos, elegir el portfolio, crear o elegir la
   cuenta de WhatsApp Business y el número, verificar el número.
5. Volver al panel: mostrar el mensaje «WhatsApp conectado» y tocar **Revisar vinculación** con los tres
   puntos en verde (número, cuenta, app suscrita).
6. Ir a **Plantillas** y tocar **Crear en Meta** en una plantilla; mostrar el estado PENDING o APPROVED.

### Video 2 — Mensajes (whatsapp_business_messaging)
1. Pantalla dividida: el celular de un cliente con WhatsApp y el panel `/admin/conversaciones`.
2. El cliente escribe «hola, ¿qué tienen?»; el asistente responde con el menú.
3. El cliente pide 2 productos y manda su dirección; el asistente responde con subtotal, envío y total.
4. El cliente confirma con «sí»; el pedido aparece en **Tablero** con canal WhatsApp.
5. En el tablero se pasa el pedido a «En camino»: llega el aviso al WhatsApp del cliente.
6. En **Conversaciones**, el admin toma el control y responde a mano.
7. El cliente escribe BAJA y recibe la confirmación.

### Video 3 — Eventos (whatsapp_business_manage_events), solo si se mantiene el permiso
Mostrar un pedido confirmado y entregado por WhatsApp y dónde se ve el evento de conversión.

## Notas para el revisor (campo «Instrucciones»)
- Usuario de prueba: completar con un admin de prueba (no usar cuentas reales).
- El número de prueba de Meta es `+1 555 195 8047`; agregar el teléfono del revisor como destinatario no es posible,
  por eso el video 2 muestra el flujo completo.
- La app se usa solo desde el panel web; no hay app móvil.
