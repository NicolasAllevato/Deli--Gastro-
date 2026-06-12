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
  category_id: string;
  is_active: boolean;
}

export const mockCategories: Category[] = [
  { id: "c1", name: "Hamburguesas",     description: "Hamburguesas artesanales 100% Angus", is_active: true  },
  { id: "c2", name: "Pizzas",           description: "Pizzas estilo napolitano",             is_active: true  },
  { id: "c3", name: "Acompañamientos",  description: "Papas, aros de cebolla",               is_active: true  },
];

export const mockProducts: Product[] = [
  { id: "1", name: "Hamburguesa Clásica",      description: "Carne 200g, cheddar, lechuga y tomate", price: 8500,  image_url: "", category_id: "c1", is_active: true  },
  { id: "2", name: "Pizza Margarita",          description: "Salsa de tomate, mozzarella y albahaca", price: 12000, image_url: "", category_id: "c2", is_active: true  },
  { id: "3", name: "Papas Fritas con Cheddar", description: "Porción grande con extra queso",          price: 5000,  image_url: "", category_id: "c3", is_active: false },
];
