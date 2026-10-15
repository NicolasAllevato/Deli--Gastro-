/** Marca del producto. Cambiar acá actualiza la landing, el pie y las páginas legales. */
export const BRAND = {
  appName: "Opsyn Dely",
  appNameParts: ["Opsyn", "Dely"] as const,
  company: "Opsyn Soluciones",
  year: 2026,
  tagline: "Delivery inteligente: pedidos, WhatsApp con IA y fidelización en una sola plataforma.",
  contactEmail: "opsyn.soluciones@gmail.com",
  legalUpdated: "14 de octubre de 2026",
} as const;

export const copyrightLine = (): string => `© ${BRAND.year} ${BRAND.company}. Todos los derechos reservados.`;
