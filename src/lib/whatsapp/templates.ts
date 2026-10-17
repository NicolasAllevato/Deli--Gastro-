export type TemplateCategory = "UTILITY" | "MARKETING";

export interface TemplateDef {
  name: string;
  label: string;
  category: TemplateCategory;
  language: "es_AR";
  /** Texto con variables {{1}}, {{2}}... Meta no admite que empiece ni termine con una variable. */
  body: string;
  footer?: string;
  /** Un valor de ejemplo por variable: Meta los pide para aprobar la plantilla. */
  example: string[];
  purpose: string;
}

/** Plantillas que usa la app. Se crean en Meta una vez y se envían por nombre. */
export const TEMPLATES: readonly TemplateDef[] = [
  {
    name: "confirmacion_pedido",
    label: "Confirmación de pedido",
    category: "UTILITY",
    language: "es_AR",
    body: "¡Hola {{1}}! Recibimos tu pedido {{2}} por {{3}}. Lo estamos preparando y llega en aproximadamente {{4}} minutos. ¡Gracias por elegirnos!",
    example: ["Juan", "#A1B2C3D4", "$5.800", "30"],
    purpose: "Se envía cuando entra un pedido hecho por la web.",
  },
  {
    name: "pedido_en_preparacion",
    label: "Seguimiento: en preparación",
    category: "UTILITY",
    language: "es_AR",
    body: "¡Hola {{1}}! Tu pedido {{2}} ya está en preparación. Te avisamos cuando salga hacia tu dirección.",
    example: ["Juan", "#A1B2C3D4"],
    purpose: "Se envía cuando la cocina acepta el pedido.",
  },
  {
    name: "pedido_en_camino",
    label: "Seguimiento: en camino",
    category: "UTILITY",
    language: "es_AR",
    body: "¡Hola {{1}}! Tu pedido {{2}} ya salió con {{3}}. Estará llegando en unos minutos.",
    example: ["Juan", "#A1B2C3D4", "Diego"],
    purpose: "Se envía cuando el pedido sale a reparto.",
  },
  {
    name: "pedido_entregado",
    label: "Seguimiento: entregado",
    category: "UTILITY",
    language: "es_AR",
    body: "¡Hola {{1}}! Tu pedido {{2}} fue entregado. ¡Que lo disfrutes!",
    example: ["Juan", "#A1B2C3D4"],
    purpose: "Se envía al marcar el pedido como entregado.",
  },
  {
    name: "encuesta_satisfaccion",
    label: "Encuesta de satisfacción",
    category: "UTILITY",
    language: "es_AR",
    body: "¡Hola {{1}}! ¿Qué tal estuvo tu pedido {{2}}? Contanos tu experiencia en este link, nos ayuda a mejorar: {{3}} ¡Gracias!",
    example: ["Juan", "#A1B2C3D4", "https://tu-local.com/cliente/resenas/123"],
    purpose: "Se envía un rato después de la entrega, a quien todavía no dejó reseña.",
  },
  {
    name: "resumen_diario",
    label: "Resumen del día (para el equipo)",
    category: "UTILITY",
    language: "es_AR",
    body: "¡Hola {{1}}! Resumen de {{2}} del {{3}}: {{4}} pedidos ({{5}}). Ventas: {{6}}. Ticket promedio: {{7}}. El detalle completo te llegó por mail.",
    example: ["Ana", "Pizzería", "16/10/2026", "42", "38 entregados y 2 cancelados", "$310.500", "$7.800"],
    purpose: "Se envía al cerrar el día a las personas habilitadas en Notificaciones.",
  },
  {
    name: "promocion",
    label: "Promoción",
    category: "MARKETING",
    language: "es_AR",
    body: "¡Hola {{1}}! {{2}} Pedí por WhatsApp o desde nuestra web.",
    footer: "Respondé BAJA para no recibir más promociones.",
    example: ["Juan", "Hoy 2x1 en pizzas hasta las 23 hs."],
    purpose: "Campañas para captar y recuperar clientes. Solo se envía a quienes aceptaron recibir promociones.",
  },
];

export function templateByName(name: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.name === name);
}

const MAX_PARAM = 300;

/** Cantidad de variables distintas del cuerpo ({{1}}..{{n}}). */
export function paramCount(body: string): number {
  return new Set(body.match(/\{\{\d+\}\}/g) ?? []).size;
}

export function renderPreview(template: TemplateDef, params: readonly string[]): string {
  return template.body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? `{{${n}}}`);
}

/** Meta rechaza variables con saltos de línea, tabulaciones o muchos espacios seguidos. */
export function sanitizeParam(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, MAX_PARAM);
}

interface MetaComponent {
  type: "BODY" | "FOOTER";
  text: string;
  example?: { body_text: string[][] };
}

export interface MetaTemplatePayload {
  name: string;
  language: string;
  category: TemplateCategory;
  components: MetaComponent[];
}

/** Cuerpo del pedido a la API de Meta para crear la plantilla. */
export function metaPayload(template: TemplateDef): MetaTemplatePayload {
  const components: MetaComponent[] = [
    { type: "BODY", text: template.body, example: { body_text: [template.example] } },
  ];
  if (template.footer) components.push({ type: "FOOTER", text: template.footer });
  return { name: template.name, language: template.language, category: template.category, components };
}
