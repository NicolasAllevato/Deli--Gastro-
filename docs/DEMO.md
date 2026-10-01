# Modo demo — probar toda la plataforma en local

El modo demo corre **toda** la plataforma con datos de ejemplo en memoria. No usa
Supabase, Cloudflare R2, n8n ni Upstash, y **no guarda nada**: al reiniciar el
servidor (o con el botón **Reiniciar** de la cinta inferior) vuelven los datos
originales.

## Cómo levantarlo

```bash
npm install        # sólo la primera vez
npm run demo
```

Abrí <http://localhost:5178>. Para otro puerto: `DEMO_PORT=3000 npm run demo`.

`npm run demo` deja en blanco todas las variables de servicios externos del
proceso, así que aunque exista un `.env.local` con claves reales **no se conecta
a ningún servicio cloud**.

## Cuentas de ejemplo

En `/login` hay un botón por rol (un clic, sin contraseña). Por si hace falta
tipearlas: contraseña `demo1234` para las tres.

| Rol | Email | Entra a |
|---|---|---|
| Administrador | `admin@deli-gastro.com` | `/admin/tablero` |
| Cliente (Sofía Martínez) | `cliente@deli-gastro.com` | `/cliente` |
| Repartidor (Diego Rojas) | `repartidor@deli-gastro.com` | `/repartidor` |

Cada portal es exclusivo de su rol: si un cliente intenta abrir `/admin` vuelve a
`/cliente`, y sin sesión todo redirige a `/login`.

## Guion sugerido (5 minutos)

Abrí dos ventanas del navegador (una normal y una de incógnito) para tener dos
sesiones a la vez.

1. **Cliente** → *Inicio*: menú por categorías, pedido activo y puntos.
   Agregá 2–3 productos (aparece la barra del carrito) → **Confirmar pedido**.
2. **Cliente** → queda en el seguimiento del pedido (se actualiza solo cada 4 s).
   Probá **Cancelar pedido** (sólo mientras esté "Recibido" y dentro de la
   ventana configurada), o dejalo seguir.
3. **Admin** → *Tablero*: el pedido nuevo aparece solo en "Recibidos". Pasalo por
   **Aceptar Pedido → Listo para Enviar**.
4. **Repartidor** → el pedido aparece en "Disponibles": **Tomar pedido →
   Marcar como entregado**.
5. **Cliente** → el seguimiento muestra cada cambio. Al entregarse, aparecen los
   puntos en *Recompensas* (**Canjear** descuenta del saldo) y **Calificar
   pedido**. Una nota de 3 o menos genera un *ticket de atención* visible en el
   detalle del pedido del admin.
6. **Admin** → *Mapa* (pedidos activos), *Pedidos* (historial y filtros),
   *Productos* (alta/edición/baja con foto), *Puntos*, *Configuración*
   (probá activar **modo pausa**: el cliente ya no puede confirmar pedidos).
7. **Cliente** → *Asistente*: preguntale "¿dónde está mi pedido?", "menú",
   "mis puntos", "horarios".

## Qué es real y qué está simulado

| Pieza | En demo | En producción (pendiente) |
|---|---|---|
| Base de datos | Memoria del servidor (`src/lib/demo/`) con el mismo contrato que Supabase | Supabase (`supabase/migrations/`) |
| Login | Cookie `demo_session` con el rol | Supabase Auth, rol en `app_metadata` |
| Fotos de productos | Se leen en el navegador y quedan como data URL | Subida a Cloudflare R2 |
| Asistente | Reglas locales con datos reales del demo | n8n + IA |
| Notificaciones / promos (admin → Puntos) | Mensaje "(simulado)" | Webhook n8n / WhatsApp |
| Despacho (`/api/dispatch`) | Responde OK sin llamar a nadie | Worker/n8n |
| Tiempo real | Consulta cada 4–5 s | Supabase Realtime |
| Mapa | Tiles de OpenStreetMap, direcciones de ejemplo | Geocodificación de direcciones reales |

La lógica de negocio (validación de pedidos, recálculo de precios y envío,
transiciones de estado, puntos y niveles, permisos por rol) es **la misma** en
demo y en producción: sólo cambia el cliente de base de datos
(`src/utils/supabase/*`).

## Cosas a tener en cuenta

- Los datos viven en el proceso de Next: si el servidor se reinicia, se pierden.
- El carrito vive en `sessionStorage` de la pestaña.
- El demo está desactivado en producción de Vercel (`VERCEL_ENV=production`) y las
  rutas `/api/demo/*` responden 404 fuera de este modo.
- Modo desarrollo normal (`npm run dev`) sigue usando Supabase real.
