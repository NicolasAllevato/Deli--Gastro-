export interface MockPedidoAdmin {
  id: string;
  cliente: string;
  total: number;
  estado: string;
  fecha: string;
  ticket: boolean;
}

export interface MockPedidoItem {
  id: number;
  nombre: string;
  cant: number;
  precio: number;
}

export interface MockPedidoDetalle extends MockPedidoAdmin {
  clienteDetalle: {
    nombre: string;
    telefono: string;
    direccion: string;
  };
  items: MockPedidoItem[];
  notasTicket?: string;
}

export const mockPedidosAdmin: MockPedidoAdmin[] = [
  { id: "ORD-001", cliente: "Juan Pérez",   total: 4500, estado: "Entregado",      fecha: "2026-05-01 12:30", ticket: false },
  { id: "ORD-002", cliente: "María López",  total: 3200, estado: "Cancelado",      fecha: "2026-05-01 13:15", ticket: true  },
  { id: "ORD-003", cliente: "Carlos Ruiz",  total: 8500, estado: "En Preparación", fecha: "2026-05-01 14:05", ticket: false },
  { id: "ORD-004", cliente: "Ana Gómez",    total: 2100, estado: "Entregado",      fecha: "2026-05-01 14:30", ticket: true  },
];

export const mockPedidosDetalle: MockPedidoDetalle[] = [
  {
    id: "ORD-001", cliente: "Juan Pérez", total: 4500, estado: "Entregado", fecha: "2026-05-01 12:30", ticket: false,
    clienteDetalle: { nombre: "Juan Pérez", telefono: "+54 9 11 5555-1234", direccion: "Av. Rivadavia 4500, CABA" },
    items: [
      { id: 1, nombre: "Hamburguesa Clásica", cant: 2, precio: 1800 },
      { id: 2, nombre: "Papas Fritas con Cheddar", cant: 1, precio: 900 },
    ],
  },
  {
    id: "ORD-002", cliente: "María López", total: 3200, estado: "Cancelado", fecha: "2026-05-01 13:15", ticket: true,
    clienteDetalle: { nombre: "María López", telefono: "+54 9 11 1234-5678", direccion: "Av. Corrientes 1234, CABA" },
    items: [
      { id: 1, nombre: "Hamburguesa Doble", cant: 2, precio: 1200 },
      { id: 2, nombre: "Papas Fritas",       cant: 1, precio: 800  },
    ],
    notasTicket: "El cliente canceló porque demoró mucho y la app marcaba 'En camino' erróneamente. Contactar para compensación.",
  },
  {
    id: "ORD-003", cliente: "Carlos Ruiz", total: 8500, estado: "En Preparación", fecha: "2026-05-01 14:05", ticket: false,
    clienteDetalle: { nombre: "Carlos Ruiz", telefono: "+54 9 11 9876-5432", direccion: "Thames 856, Palermo" },
    items: [
      { id: 1, nombre: "Pizza Margarita",    cant: 1, precio: 4200 },
      { id: 2, nombre: "Pizza Napolitana",   cant: 1, precio: 4300 },
    ],
  },
  {
    id: "ORD-004", cliente: "Ana Gómez", total: 2100, estado: "Entregado", fecha: "2026-05-01 14:30", ticket: true,
    clienteDetalle: { nombre: "Ana Gómez", telefono: "+54 9 11 7777-8888", direccion: "Av. Santa Fe 3400, Recoleta" },
    items: [
      { id: 1, nombre: "Papas Fritas con Cheddar", cant: 1, precio: 900 },
      { id: 2, nombre: "Limonada",                  cant: 2, precio: 600 },
    ],
    notasTicket: "El cliente recibió el pedido frío. Se aplicó descuento del 20% en el próximo pedido.",
  },
];
