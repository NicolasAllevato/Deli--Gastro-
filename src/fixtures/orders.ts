export type OrderStatus = "Recibidos" | "En Preparación" | "En Camino" | "Finalizados";

export interface MockOrder {
  id: string;
  items: string;
  time: string;
  status: OrderStatus;
  price: string;
  minutesAgo: number;
}

export interface MockEntrega {
  id: string;
  lat: number;
  lng: number;
  cliente: string;
  estado: string;
  direccion: string;
  minutos: number;
}

export const mockOrders: MockOrder[] = [
  { id: "#1204", items: "4 items • Takeaway",        time: "05:00 min", status: "Recibidos",      price: "$ 4.500", minutesAgo: 2  },
  { id: "#1205", items: "1 items • Delivery",         time: "01:00 min", status: "Recibidos",      price: "$ 1.200", minutesAgo: 1  },
  { id: "#1201", items: "2 items • Delivery",         time: "12:30 min", status: "En Preparación", price: "$ 3.200", minutesAgo: 15 },
  { id: "#1198", items: "5 items • Delivery Rapido",  time: "25:00 min", status: "En Camino",      price: "$ 5.800", minutesAgo: 25 },
];

export const mockEntregas: MockEntrega[] = [
  { id: "#1204", lat: -34.6037, lng: -58.3816, cliente: "Juan Pérez",  estado: "En Camino",      direccion: "Av. Corrientes 1234", minutos: 8  },
  { id: "#1198", lat: -34.6080, lng: -58.3700, cliente: "María López", estado: "En Camino",      direccion: "Thames 856",          minutos: 15 },
  { id: "#1201", lat: -34.6060, lng: -58.3770, cliente: "Carlos Ruiz", estado: "En Preparación", direccion: "Av. Santa Fe 3400",   minutos: 22 },
];
