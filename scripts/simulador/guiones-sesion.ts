/**
 * Guiones de contexto por pedido (sesión) y de cliente registrado. Cada uno siembra su pasado en la base local:
 * charla vieja ya guardada (`previo`) o ficha con pedidos entregados (`registrado`). Son el único lugar del simulacro
 * donde la conversación NO empieza vacía.
 */
import type { Guion } from "./guiones.ts";

const SIN_PEDIR = /Decime qu[eé] quer[eé]s pedir/i;
const CONFIRMADO = "¡Listo! Tu pedido quedó confirmado ✅ Número de pedido: #SIM00031. Total: $51.000, en efectivo al recibir.\nDemora estimada: unos 40 minutos.\nTe avisamos por acá cuando salga 🛵";
const RESUMEN_PROMO = "Resumen de tu pedido:\n1 x Baila Ahora (Pepsi, Seven Up)\nDirección: Juramento 1500\nEnvío: $1.500\nTotal: $52.500\n¿Cómo vas a pagar: efectivo o Mercado Pago?";

export const GUIONES_SESION: readonly Guion[] = [
  { numero: 60, titulo: "Pedido viejo cerrado (promo con gaseosas): el pedido nuevo no arrastra nada", previo: [
    { de: "cliente", texto: "quiero la promo Baila Ahora para Juramento 1500", haceMin: 300 },
    { de: "bot", texto: "¿Qué 2 gaseosas preferís?", haceMin: 299 },
    { de: "cliente", texto: "pepsi y seven up", haceMin: 298 },
    { de: "bot", texto: CONFIRMADO, haceMin: 290 },
  ], pasos: [
    { dice: "quiero 2 muzzarella grandes para delivery a Av. Santa Fe 1234, Palermo",
      esperaAlguna: [/2 x Muzzarella/i, /efectivo o Mercado Pago/i],
      noDebe: [SIN_PEDIR, /Baila Ahora|gaseosa|Pepsi|Seven|Juramento/i] },
    { dice: "efectivo", esperaAlguna: [/Efectivo/i, /Respond[eé] S[IÍ]/i], noDebe: [/Baila Ahora|Pepsi|Seven/i] },
  ] },
  { numero: 61, titulo: "Resumen viejo abandonado (más de 150 min): «sacá las medialunas» no cotiza la promo de antes", previo: [
    { de: "cliente", texto: "quiero la promo Baila Ahora para Juramento 1500", haceMin: 400 },
    { de: "bot", texto: RESUMEN_PROMO, haceMin: 399 },
  ], pasos: [
    { dice: "sacá las medialunas", noDebe: [/Baila Ahora|Resumen de tu pedido|Pepsi|Seven/i] },
  ] },
  { numero: 62, titulo: "Cliente registrado con 2 direcciones: saluda por nombre y ofrece SOLO la última", registrado: {
    nombre: "Martina Gómez",
    pedidos: [{ direccion: "Av. Cabildo 2000, Belgrano", haceDias: 30 }, { direccion: "Juramento 1500, Belgrano", haceDias: 3 }],
  }, pasos: [
    { dice: "hola", esperaAlguna: [/Martina/i], noDebe: [/Cabildo/i] },
    { dice: "quiero 2 muzzarella grandes para delivery",
      esperaAlguna: [/¿Te lo enviamos a Juramento 1500, Belgrano\?/i], noDebe: [/Cabildo/i, /Resumen de tu pedido/i] },
    { dice: "sí", esperaAlguna: [/Juramento 1500, Belgrano/i, /efectivo o Mercado Pago/i], noDebe: [/Cabildo/i] },
  ] },
  { numero: 63, titulo: "Cliente registrado que da otra dirección: se usa esa y no se ofrece la guardada", registrado: {
    nombre: "Martina Gómez",
    pedidos: [{ direccion: "Juramento 1500, Belgrano", haceDias: 3 }],
  }, pasos: [
    { dice: "quiero 1 muzzarella grande para delivery a Av. Santa Fe 1234, Palermo",
      esperaAlguna: [/Santa Fe 1234/i, /efectivo o Mercado Pago/i], noDebe: [/Te lo enviamos a/i, /Juramento/i] },
  ] },
  { numero: 64, titulo: "Cliente nuevo (sin ficha): se le pide la dirección como siempre", pasos: [
    { dice: "hola", esperaAlguna: [/Gambi|Gambeta/i] },
    { dice: "quiero 2 muzzarella grandes para delivery",
      esperaAlguna: [/direcci[oó]n|d[oó]nde/i], noDebe: [/Te lo enviamos a/i, /Resumen de tu pedido/i] },
  ] },
  { numero: 65, titulo: "«¿Tienen empanadas de humita?»: existe, no se niega", pasos: [
    { dice: "¿Tienen empanadas de humita?", esperaAlguna: [/humita/i], noDebe: [/no (las |lo )?(trabajamos|tenemos|hay)/i, /sushi/i] },
  ] },
  { numero: 66, titulo: "«¿Tienen cerveza sin alcohol?»: ofrece las Zero y no copia ejemplos ajenos", pasos: [
    { dice: "¿Tienen cerveza sin alcohol?", esperaAlguna: [/Zero/i], noDebe: [/no (las |lo )?(trabajamos|tenemos|hay)/i, /sushi/i] },
  ] },
  { numero: 67, titulo: "Consulta de precio: recordatorio del portal una sola vez (lo controla el código)", pasos: [
    { dice: "¿Cuánto sale la muzzarella grande?", esperaAlguna: [/pedir directo desde nuestra web: https:\/\/opsyndely\.la-gambeta\.com\/cliente/i] },
    { dice: "¿y la napolitana?", esperaAlguna: [/Napolitana|14.500/i], noDebe: [/pedir directo/i] },
  ] },
  { numero: 68, titulo: "Algo que no vendemos: el «no lo trabajamos» nombra lo que pidió el cliente", pasos: [
    { dice: "¿Tienen pastas?", esperaAlguna: [/pastas/i], noDebe: [/sushi/i] },
  ] },
];
