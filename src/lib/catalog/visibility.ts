/**
 * Visibilidad de un producto en el portal del cliente.
 * - `is_active`: disponibilidad (la manda Fudo en los productos vinculados).
 * - `show_in_portal`: interruptor del admin. Los productos nuevos de Fudo entran ocultos (default 0 en D1).
 * Supabase (congelado) no tiene la columna: si no viene, el producto cuenta como visible (comportamiento previo).
 */
export interface PortalVisibilityFields {
  is_active?: boolean | number | null;
  show_in_portal?: boolean | number | null;
}

const isOff = (v: boolean | number | null | undefined): boolean => v === false || v === 0;

export function isPortalVisible(p: PortalVisibilityFields): boolean {
  return !isOff(p.is_active) && !isOff(p.show_in_portal);
}
