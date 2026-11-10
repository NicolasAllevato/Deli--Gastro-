# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Tres públicos, cada uno con su portal. Cliente y admin tienen la misma prioridad cuando hay que decidir entre ambos (confirmado 2026-11-10).

- **Cliente:** pide comida desde el celular: carta, carrito, pago, seguimiento del pedido, chat con IA, reseñas y puntos de fidelidad.
- **Admin del local:** opera el negocio durante el servicio: tablero de pedidos, mapa, WhatsApp, carta, repartidores, informes.
- **Repartidor:** abre su sesión con PIN, espera la habilitación del día, toma pedidos y los entrega. Usa la app en la calle, desde una APK (Capacitor) sobre su propio celular.

## Product Purpose

Opsyn Dely es el delivery inteligente de Opsyn Soluciones: reúne pedidos, WhatsApp con IA y fidelización en una sola plataforma para un local gastronómico.

## Positioning

Producto de OPSYN pensado para venderse a distintos locales: Opsyn Dely es la marca de la plataforma y cada local se monta encima (confirmado 2026-11-10). La Pizzería La Gambeta es el local que hoy la usa en producción.

## Operating Context

- El admin trabaja con varias pantallas en vivo durante el servicio; los pedidos llegan por la app, por WhatsApp y desde Fudo (incluidos PedidosYa, Rappi y Morfy).
- El día de trabajo de los repartidores cambia a las 06:00 de Argentina.
- Clientes y repartidores usan principalmente celulares, incluidos equipos de gama baja.

## Capabilities and Constraints

- Tema claro y oscuro global, oscuro por defecto.
- Interfaz en español de Argentina.
- Integraciones activas: Fudo, WhatsApp Business (Meta), Mercado Pago, Supabase; despliegue en Cloudflare con OpenNext.
- La política de seguridad de contenido actual no permite WebAssembly.
- Modo demo sin Supabase (`npm run demo`).

## Brand Commitments

- Nombre: Opsyn Dely, de Opsyn Soluciones.
- Identidad vigente, a refinar y no a reemplazar (confirmado 2026-11-10): sistema neumórfico, violeta `#7c3aed` como color de marca, Manrope para títulos e Inter para cuerpo.
- Como cada local se monta encima, lo propio del local no debe quedar fijo en el código.
- Activos: `public/brand/opsyn-dely-logo.jpg` y `public/brand/opsyn-dely-icon.png`.

## Evidence on Hand

La carta, las fotos y los pedidos reales son de La Gambeta. No hay testimonios ni métricas de clientes que se puedan citar; no inventarlos.

## Product Principles

1. El servicio no se frena: en plena operación, la información correcta se lee de un vistazo.
2. Funciona en el celular que la gente ya tiene, también con mala señal y gama baja.
3. La plataforma es de OPSYN y el local es protagonista de su propia carta.
4. Accesible para todos: los criterios de la sección siguiente son requisito, no mejora.

## Accessibility & Inclusion

WCAG 2.2 AA en ambos temas, con movimiento reducido respetado en toda la app (objetivos fijados en `docs/plan-frontera-ui.md`, sección 4.1).
