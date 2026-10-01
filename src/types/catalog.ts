export interface Category {
  id: string;
  name: string;
  description: string;
  is_active: boolean;
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
}
