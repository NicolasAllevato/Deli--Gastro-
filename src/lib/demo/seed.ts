import { SAMPLE_ADDRESSES } from "@/lib/restaurant";
import { DEMO_ACCOUNTS } from "@/lib/demo/users";

export type Row = Record<string, unknown>;
export type TableName =
  | "clients"
  | "orders"
  | "points_ledger"
  | "global_config"
  | "categories"
  | "products"
  | "reviews";

export type Tables = Record<TableName, Row[]>;

/**
 * UUID v4 determinístico (válido para z.uuid) a partir de un grupo y un número.
 * Grupo y número van al inicio para que `#XXXXXXXX` (primeros 8 caracteres)
 * distinga un pedido de otro en pantalla.
 */
export function demoId(group: number, n: number): string {
  return `${String(group).padStart(2, "0")}${String(n).padStart(6, "0")}-0000-4000-8000-000000000000`;
}

const G = { cat: 1, prod: 2, client: 3, order: 4, ledger: 5, review: 6 } as const;

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const img = (seed: string) => `https://picsum.photos/seed/${seed}/600/400`;

const CATEGORIES = [
  { name: "Hamburguesas",    description: "Hamburguesas artesanales 100% Angus" },
  { name: "Pizzas",          description: "Pizzas estilo napolitano" },
  { name: "Acompañamientos", description: "Papas, aros de cebolla y más" },
  { name: "Bebidas",         description: "Gaseosas, limonadas y cervezas" },
  { name: "Postres",         description: "Dulces para cerrar" },
] as const;

// [categoría, nombre, descripción, precio, seed de imagen, activo]
const PRODUCTS: ReadonlyArray<readonly [number, string, string, number, string, boolean]> = [
  [0, "Hamburguesa Clásica",        "Carne 200g, cheddar, lechuga y tomate",     8500,  "burger-clasica",  true],
  [0, "Hamburguesa Doble BBQ",      "Doble carne, panceta crocante y salsa BBQ", 11200, "burger-bbq",      true],
  [0, "Hamburguesa Veggie",         "Medallón de garbanzos, palta y rúcula",     8900,  "burger-veggie",   true],
  [1, "Pizza Margarita",            "Salsa de tomate, mozzarella y albahaca",    12000, "pizza-margarita", true],
  [1, "Pizza Napolitana",           "Mozzarella, tomate fresco, ajo y orégano",  12800, "pizza-napo",      true],
  [1, "Pizza Pepperoni",            "Mozzarella y pepperoni picante",            13500, "pizza-pepperoni", true],
  [2, "Papas Fritas con Cheddar",   "Porción grande con extra queso",            5000,  "papas-cheddar",   true],
  [2, "Aros de Cebolla",            "Rebozados y dorados, con dip ranch",        4200,  "aros-cebolla",    true],
  [3, "Limonada con Menta",         "Exprimida al momento, 500 ml",              2600,  "limonada",        true],
  [3, "Cerveza Artesanal IPA",      "Pinta 473 ml",                              4300,  "cerveza-ipa",     true],
  [4, "Volcán de Cacao",            "Chocolate caliente con helado de crema",    5600,  "volcan-cacao",    true],
  [4, "Cheesecake de Frutos Rojos", "Porción individual (sin stock hoy)",        5200,  "cheesecake",      false],
];

// [nombre, teléfono, índice de dirección, nivel, puntos]
const CLIENTS: ReadonlyArray<readonly [string, string, number, string, number]> = [
  ["Sofía Martínez",  "+54 9 11 5555-0101", 0, "Plata",   180],
  ["Juan Pérez",      "+54 9 11 5555-1234", 3, "Oro",     340],
  ["María López",     "+54 9 11 1234-5678", 0, "Bronce",  60],
  ["Carlos Ruiz",     "+54 9 11 9876-5432", 1, "Platino", 520],
  ["Ana Gómez",       "+54 9 11 7777-8888", 2, "Plata",   210],
  ["Lucas Fernández", "+54 9 11 4444-3210", 4, "Bronce",  35],
];

interface OrderSpec {
  client: number;
  status: string;
  minutesAgo: number;
  items: ReadonlyArray<readonly [number, number]>; // [índice de producto, cantidad]
  fee: number;
  pay: string;
  address: number;
  courier?: string;
  notes?: string;
}

const ORDERS: readonly OrderSpec[] = [
  { client: 0, status: "Finalizados",    minutesAgo: 2880, items: [[0, 1], [6, 1]],  fee: 800,  pay: "Tarjeta",      address: 0 },
  { client: 0, status: "En Preparación", minutesAgo: 12,   items: [[3, 1], [8, 2]],  fee: 650,  pay: "Mercado Pago", address: 0, notes: "Sin albahaca, por favor" },
  { client: 1, status: "Finalizados",    minutesAgo: 1500, items: [[1, 2], [7, 1]],  fee: 900,  pay: "Efectivo",     address: 3, courier: "Diego Rojas" },
  { client: 2, status: "Cancelado",      minutesAgo: 1400, items: [[0, 2], [6, 1]],  fee: 650,  pay: "Tarjeta",      address: 0 },
  { client: 3, status: "En Camino",      minutesAgo: 28,   items: [[3, 1], [4, 1]],  fee: 700,  pay: "Mercado Pago", address: 1, courier: "Diego Rojas" },
  { client: 4, status: "Finalizados",    minutesAgo: 1300, items: [[6, 1], [8, 2]],  fee: 750,  pay: "Tarjeta",      address: 2, courier: "Diego Rojas" },
  { client: 5, status: "Recibidos",      minutesAgo: 3,    items: [[2, 1], [9, 1]],  fee: 1200, pay: "Efectivo",     address: 4 },
  { client: 1, status: "Recibidos",      minutesAgo: 1,    items: [[5, 1], [10, 2]], fee: 900,  pay: "Tarjeta",      address: 3 },
  { client: 4, status: "En Camino",      minutesAgo: 22,   items: [[1, 1]],          fee: 750,  pay: "Efectivo",     address: 2, courier: "Diego Rojas" },
  { client: 3, status: "Finalizados",    minutesAgo: 95,   items: [[4, 2]],          fee: 700,  pay: "Mercado Pago", address: 1, courier: "Diego Rojas" },
];

export function buildSeed(): Tables {
  const categories: Row[] = CATEGORIES.map((c, i) => ({
    id: demoId(G.cat, i + 1),
    name: c.name,
    description: c.description,
    is_active: true,
    created_at: ago(60 * 24 * 30),
    updated_at: ago(60 * 24 * 30),
  }));

  const products: Row[] = PRODUCTS.map(([cat, name, description, price, seed, active], i) => ({
    id: demoId(G.prod, i + 1),
    category_id: demoId(G.cat, cat + 1),
    name,
    description,
    price,
    image_url: img(seed),
    is_active: active,
    created_at: ago(60 * 24 * 30),
    updated_at: ago(60 * 24 * 30),
  }));

  const clientUserId = DEMO_ACCOUNTS.find((a) => a.role === "cliente")!.id;
  const clients: Row[] = CLIENTS.map(([name, phone, addr, tier, points], i) => ({
    id: demoId(G.client, i + 1),
    user_id: i === 0 ? clientUserId : null,
    name,
    phone,
    address: SAMPLE_ADDRESSES[addr]!.address,
    tier,
    total_points: points,
    created_at: ago(60 * 24 * (120 - i * 15)),
    updated_at: ago(60 * 24),
  }));

  const orders: Row[] = ORDERS.map((o, i) => {
    const lines = o.items.map(([p, qty]) => ({ product: PRODUCTS[p]!, qty }));
    const subtotal = lines.reduce((s, l) => s + l.product[3] * l.qty, 0);
    const addr = SAMPLE_ADDRESSES[o.address]!;
    return {
      id: demoId(G.order, i + 1),
      client_id: demoId(G.client, o.client + 1),
      status: o.status,
      items_desc: lines.map((l) => `${l.qty}x ${l.product[1]}`).join(" · "),
      total: subtotal + o.fee,
      delivery_fee: o.fee,
      delivery_address: addr.address,
      delivery_lat: addr.lat,
      delivery_lng: addr.lng,
      payment_method: o.pay,
      notes: o.notes ?? null,
      courier_name: o.courier ?? null,
      created_at: ago(o.minutesAgo),
      updated_at: ago(Math.max(0, o.minutesAgo - 5)),
    };
  });

  const points_ledger: Row[] = [];
  let ledgerN = 0;
  for (const c of clients) {
    points_ledger.push({
      id: demoId(G.ledger, ++ledgerN),
      client_id: c.id,
      order_id: null,
      delta: 50,
      description: "Puntos de bienvenida",
      created_at: c.created_at,
    });
  }
  for (const o of orders) {
    if (o.status !== "Finalizados") continue;
    points_ledger.push({
      id: demoId(G.ledger, ++ledgerN),
      client_id: o.client_id,
      order_id: o.id,
      delta: Math.floor((Number(o.total) / 100) * 0.5),
      description: `Pedido ${o.items_desc}`,
      created_at: o.updated_at,
    });
  }

  const finalizados = orders.filter((o) => o.status === "Finalizados");
  const reviews: Row[] = [
    {
      id: demoId(G.review, 1),
      order_id: finalizados[1]?.id,
      client_id: finalizados[1]?.client_id,
      rating: 2,
      feedback: "El pedido llegó frío y tardó más de lo prometido.",
      created_at: ago(1200),
    },
    {
      id: demoId(G.review, 2),
      order_id: finalizados[2]?.id,
      client_id: finalizados[2]?.client_id,
      rating: 5,
      feedback: null,
      created_at: ago(1100),
    },
  ].filter((r) => r.order_id);

  const global_config: Row[] = (
    [
      ["tienda_activa", true],
      ["modo_pausa", false],
      ["radio_delivery_km", 8],
      ["tiempo_entrega_min", 30],
      ["horario_apertura", "11:00"],
      ["horario_cierre", "23:00"],
      ["whatsapp_numero", "+541100000000"],
      ["google_maps_url", "https://maps.google.com/?q=Deli+Gastro"],
      ["cancelacion_min", 15],
      ["costo_por_km", 150],
      ["puntos_por_100", 0.5],
      ["puntos_minimos", 5],
      ["puntos_vencimiento_dias", 180],
      ["puntos_bienvenida", 50],
      ["notif_webhook", ""],
      ["notif_email_from", "noreply@deli-gastro.com"],
      [
        "notif_template",
        "¡Hola {nombre}! Tenés {puntos} puntos acumulados y podés canjear {promo}. ¡Aprovechalo!",
      ],
    ] as const
  ).map(([key, value]) => ({ key, value, updated_at: ago(60 * 24 * 30) }));

  return { clients, orders, points_ledger, global_config, categories, products, reviews };
}
