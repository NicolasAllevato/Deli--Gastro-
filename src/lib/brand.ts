/** Marca del producto. Cambiar acá actualiza la landing, el pie y las páginas legales. */
export const BRAND = {
  appName: "Opsyn Dely",
  appNameParts: ["Opsyn", "Dely"] as const,
  company: "Opsyn Soluciones",
  year: 2026,
  tagline: "Delivery inteligente: pedidos, WhatsApp con IA y fidelización en una sola plataforma.",
  contactEmail: "contacto@la-gambeta.com",
  legalUpdated: "5 de noviembre de 2026",
  /** Titular del servicio, tal como figura en la constancia de ARCA (lo pide Meta para verificar). */
  legal: {
    holder: "Nicolás Hernán Allevato",
    cuit: "20-36721291-9",
    address: "Piedras 1841, piso 8, depto. A, C1140, Ciudad Autónoma de Buenos Aires, Argentina",
  },
} as const;

export const copyrightLine = (): string => `© ${BRAND.year} ${BRAND.company}. Todos los derechos reservados.`;
