/**
 * Guiones que solo corren con `--datos-reales` (menú, carta y opciones exportados de producción): reproducen fallas vistas
 * en producción que el menú de ejemplo de `mundo.ts` no reflejaba (nombres como «Empanada Humita», dirección larga del geocoder).
 */
import type { Guion } from "./guiones.ts";

const SIN_PEDIR = /Decime qu[eé] quer[eé]s pedir/i;
/** Dirección del cliente de prueba de producción, tal como la guardó el geocoder (con piso y departamento). */
const DIRECCION_GEOCODER = "Army, 5000, Avenida Rivadavia, Caballito, Buenos Aires, Comuna 6, Ciudad Autónoma de Buenos Aires, C1424CER, Argentina — piso 3 dto B";

export const GUIONES_REALES: readonly Guion[] = [
  { numero: 70, titulo: "[real] «¿tienen empanadas de humita?»: existe como «Empanada Humita», no se niega", datosReales: true, pasos: [
    { dice: "tienen empanadas de humita?", esperaAlguna: [/humita/i], noDebe: [/no (las |lo )?(trabajamos|tenemos|hay)/i, /no tenemos/i, /sushi/i] },
  ] },
  { numero: 71, titulo: "[real] «hola, quiero la promo Baila Ahora»: responde la promo en el mismo turno y pregunta las 2 gaseosas", datosReales: true, pasos: [
    { dice: "hola, quiero la promo Baila Ahora",
      // La pregunta tiene que ser del bot sobre las gaseosas (el saludo con promos también nombra «Gaseosa» y «2»).
      esperaAlguna: [/(?=[^]*¿[^?]*(?:gaseosas?|bebidas?)[^?]*\?)(?=[^]*¿[^?]*\b(?:2|dos)\b[^?]*\?)/i], noDebe: [SIN_PEDIR, /Te gustar[ií]a pedir algo de esto/i] },
  ] },
  { numero: 72, titulo: "[real] Cliente registrado (phone_digits NULL, pedido «Recibidos» con dirección larga): ofrece la dirección corta", datosReales: true, registrado: {
    nombre: "Nicolas", formatoProduccion: true, pedidos: [{ direccion: DIRECCION_GEOCODER, haceDias: 0, estado: "Recibidos" }],
  }, pasos: [
    { dice: "hola, quiero 2 porciones de muzza",
      esperaAlguna: [/¿Te lo enviamos a Avenida Rivadavia 5000, piso 3 dto B\?/i],
      noDebe: [/necesito la direcci[oó]n/i, /Army|Argentina|Comuna|C1424CER/i, /Resumen de tu pedido/i] },
  ] },
];
