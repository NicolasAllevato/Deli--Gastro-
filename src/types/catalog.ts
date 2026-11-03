export interface Category {
  id: string;
  name: string;
  description: string;
  is_active: boolean;
  /** Puntos por cada $100 de sus platos. `null` = la categoría no da puntos. */
  points_per_100: number | null;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  image_url: string;
  /** Cadena vacía = sin categoría. */
  category_id: string;
  is_active: boolean;
  /** Puntos por cada $100 del plato; pisa los de la categoría. `null` = hereda. */
  points_per_100: number | null;
  /** Id en Fudo. Si está, Fudo manda en nombre, precio, disponibilidad y categoría (solo lectura acá). */
  fudo_id?: number | null;
}
