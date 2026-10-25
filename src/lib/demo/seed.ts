import { RESTAURANT_LOCATION, SAMPLE_ADDRESSES } from "@/lib/restaurant";
import { DEMO_ACCOUNTS } from "@/lib/demo/users";
import { DEMO_COURIER_PIN, DEMO_PIN_SECRET, hashPin } from "@/lib/courier-pins";

export type Row = Record<string, unknown>;
export type TableName =
  | "clients"
  | "orders"
  | "points_ledger"
  | "global_config"
  | "categories"
  | "products"
  | "reviews"
  | "order_events"
  | "delivery_zones"
  | "integration_secrets"
  | "wa_conversations"
  | "wa_messages"
  | "wa_campaigns"
  | "legal_acceptances"
  | "payment_intents"
  | "order_items"
  | "courier_locations"
  | "couriers";

export type Tables = Record<TableName, Row[]>;

/** El repartidor de ejemplo, dado de alta con su PIN (1234) como si lo hubiera cargado el admin. */
function demoCouriers(): Row[] {
  const courier = DEMO_ACCOUNTS.find((a) => a.role === "repartidor");
  if (!courier) return [];
  const created = "2026-01-01T00:00:00.000Z";
  return [{
    id: courier.id, user_id: courier.id, name: courier.name, pin_hash: hashPin(DEMO_COURIER_PIN, DEMO_PIN_SECRET),
    active: true, created_at: created, updated_at: created,
  }];
}

/**
 * UUID v4 determinístico (válido para z.uuid) a partir de un grupo y un número.
 * Grupo y número van al inicio para que `#XXXXXXXX` (primeros 8 caracteres)
 * distinga un pedido de otro en pantalla.
 */
export function demoId(group: number, n: number): string {
  return `${String(group).padStart(2, "0")}${String(n).padStart(6, "0")}-0000-4000-8000-000000000000`;
}

const G = { cat: 1, prod: 2, client: 3, order: 4, ledger: 5, review: 6, zone: 7 } as const;

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** Fotos de muestra generadas con Gemini (`scripts/generar-fotos-demo.mjs`). */
const img = (seed: string) => `/demo/productos/${seed}.jpg`;

const CATEGORIES = [
  { name: "Hamburguesas",    description: "Hamburguesas artesanales 100% Angus", points: 1 },
  { name: "Pizzas",          description: "Pizzas estilo napolitano",            points: 1 },
  { name: "Acompañamientos", description: "Papas, aros de cebolla y más",        points: 0.5 },
  { name: "Bebidas",         description: "Gaseosas, limonadas y cervezas",      points: 0.25 },
  { name: "Postres",         description: "Dulces para cerrar",                  points: 1 },
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

/** Tiempos de etapa de ejemplo (minutos desde la creación): acepta +2, listo +15, sale +18, entrega +40. */
function stageSeed(status: string, minutesAgo: number): Record<string, string | null> {
  const at = (offset: number, from: string[]) =>
    from.includes(status) ? ago(Math.max(0, minutesAgo - offset)) : null;
  return {
    accepted_at: at(2, ["En Preparación", "En Camino", "Finalizados"]),
    ready_at: at(15, ["En Camino", "Finalizados"]),
    picked_up_at: at(18, ["En Camino", "Finalizados"]),
    delivered_at: at(40, ["Finalizados"]),
  };
}

/* ---------- Volumen para el tablero ejecutivo (determinista: PRNG con semilla fija) ---------- */

type Rand = () => number;

/** mulberry32: pseudoaleatorio reproducible. Mismo seed, misma secuencia. */
function prng(seed: number): Rand {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EXTRA_SEED = 20260410;
const EXTRA_ORDER_COUNT = 300;
const EXTRA_CANCEL_COUNT = 15; // ~5%
const EXTRA_REVIEW_COUNT = 120;
/** 45% web, 35% whatsapp, 20% mostrador sobre 300 pedidos. */
const CHANNEL_MIX: ReadonlyArray<readonly [string, number]> = [["web", 135], ["whatsapp", 105], ["mostrador", 60]];
const PAYMENTS = ["Efectivo", "Tarjeta", "Mercado Pago"] as const;
const COURIERS = ["Diego Rojas", "Lucía Vera", "Marcos Solé"] as const;
const LOW_FEEDBACK = [
  "Llegó frío y tardó más de lo prometido.",
  "La hamburguesa llegó aplastada.",
  "Se demoró mucho en la entrega y nadie avisó.",
  "Faltó una bebida que había pedido.",
  "La pizza llegó tibia.",
  "La comida bien, pero el envío fue lento.",
] as const;
const GOOD_FEEDBACK = ["¡Excelente, gracias!", "Muy rico, volvemos a pedir.", "Llegó rápido y bien empaquetado."] as const;

/**
 * Zonas rectangulares demo (box = [minLat, maxLat, minLng, maxLng]) ubicadas a más
 * de 8 km del local, fuera de los círculos de las zonas existentes: no se superponen.
 * Z5 y Z6 son las lentas: generan alertas de demora en el tablero.
 */
interface DemoZone {
  name: string;
  box: readonly [number, number, number, number];
  fee: number;
  minOrder: number;
  slow: boolean;
}

const DEMO_ZONES: readonly DemoZone[] = [
  { name: "Z1", box: [-34.515, -34.485, -58.42, -58.38], fee: 900, minOrder: 0, slow: false },
  { name: "Z2", box: [-34.715, -34.685, -58.42, -58.38], fee: 900, minOrder: 0, slow: false },
  { name: "Z3", box: [-34.62, -34.59, -58.28, -58.25], fee: 1100, minOrder: 8000, slow: false },
  { name: "Z4", box: [-34.62, -34.59, -58.52, -58.49], fee: 1200, minOrder: 0, slow: false },
  { name: "Z5", box: [-34.53, -34.5, -58.3, -58.27], fee: 1400, minOrder: 10000, slow: true },
  { name: "Z6", box: [-34.7, -34.67, -58.52, -58.49], fee: 1400, minOrder: 10000, slow: true },
];

const ACTIVE_PRODUCTS: readonly number[] = PRODUCTS.flatMap((p, i) => (p[5] ? [i] : []));

const round6 = (n: number) => Number(n.toFixed(6));

function intIn(rand: Rand, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

function pick<T>(rand: Rand, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

function shuffle<T>(items: readonly T[], rand: Rand): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function boxCorners([minLat, maxLat, minLng, maxLng]: DemoZone["box"]): Array<[number, number]> {
  return [[minLat, minLng], [minLat, maxLng], [maxLat, maxLng], [maxLat, minLng]];
}

/** Arma una canasta de 1 a 3 productos cuyo subtotal cae en [lo, hi]. */
function pickItems(rand: Rand, lo: number, hi: number): { lines: Array<[number, number]>; subtotal: number } {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const merged = new Map<number, number>();
    const n = intIn(rand, 1, 3);
    for (let k = 0; k < n; k++) {
      const p = pick(rand, ACTIVE_PRODUCTS);
      merged.set(p, (merged.get(p) ?? 0) + intIn(rand, 1, 2));
    }
    const lines = [...merged.entries()];
    const subtotal = lines.reduce((s, [p, q]) => s + PRODUCTS[p]![3] * q, 0);
    if (subtotal >= lo && subtotal <= hi) return { lines, subtotal };
  }
  throw new Error("No se pudo armar un pedido dentro del rango de montos");
}

/**
 * Minutos desde la creación de cada etapa. Prep 10-28, aceptación 2-5, retiro 2-8.
 * Entrega total 25-60 (zonas lentas 45-75). El mostrador retira en 1-3 min tras listo.
 */
function stageMinutes(rand: Rand, mostrador: boolean, slow: boolean) {
  const accept = intIn(rand, 2, 5);
  const prep = intIn(rand, 10, 28);
  if (mostrador) {
    const pickup = intIn(rand, 1, 3);
    const picked = accept + prep + pickup;
    return { accept, ready: accept + prep, picked, total: picked };
  }
  const pickup = intIn(rand, 2, 8);
  const target = slow ? intIn(rand, 45, 75) : intIn(rand, 25, 60);
  const total = Math.max(target, accept + prep + pickup + 5);
  return { accept, ready: accept + prep, picked: accept + prep + pickup, total };
}

function buildExtraOrders(
  base: number,
  clientIds: readonly string[],
  rand: Rand,
): { orders: Row[]; slowIds: Set<string> } {
  const ago = (minutes: number) => new Date(base - minutes * 60_000).toISOString();
  const channels = shuffle(CHANNEL_MIX.flatMap(([ch, n]) => Array.from({ length: n }, () => ch)), rand);
  const cancelIdx = new Set(
    shuffle(Array.from({ length: EXTRA_ORDER_COUNT }, (_, i) => i), rand).slice(0, EXTRA_CANCEL_COUNT),
  );
  const slowIds = new Set<string>();
  const orders: Row[] = [];

  for (let i = 0; i < EXTRA_ORDER_COUNT; i++) {
    const id = demoId(G.order, ORDERS.length + i + 1);
    const channel = channels[i]!;
    const mostrador = channel === "mostrador";
    const zone = pick(rand, DEMO_ZONES);
    const createdAgo = intIn(rand, 120, 43_200); // entre 2 h y 30 días atrás
    const fee = mostrador ? 0 : zone.fee;
    const lo = mostrador ? 6000 : Math.max(6000 - fee, zone.minOrder);
    const { lines, subtotal } = pickItems(rand, lo, 25_000 - fee);
    const clientId = pick(rand, clientIds);
    const payment = pick(rand, PAYMENTS);
    const courier = mostrador ? null : pick(rand, COURIERS);
    const [minLat, maxLat, minLng, maxLng] = zone.box;
    const lat = round6(minLat + rand() * (maxLat - minLat));
    const lng = round6(minLng + rand() * (maxLng - minLng));
    if (zone.slow) slowIds.add(id);

    const baseRow: Row = {
      id,
      client_id: clientId,
      items_desc: lines.map(([p, q]) => `${q}x ${PRODUCTS[p]![1]}`).join(" · "),
      total: subtotal + fee,
      delivery_fee: fee,
      delivery_address: mostrador ? "Retiro en mostrador" : `Dirección demo ${i + 1}, ${zone.name}`,
      delivery_lat: lat,
      delivery_lng: lng,
      payment_method: payment,
      notes: null,
      courier_name: courier,
      channel,
      created_at: ago(createdAgo),
    };

    if (cancelIdx.has(i)) {
      orders.push({
        ...baseRow,
        status: "Cancelado",
        accepted_at: null,
        ready_at: null,
        picked_up_at: null,
        delivered_at: null,
        updated_at: ago(createdAgo - 10),
      });
      continue;
    }

    const t = stageMinutes(rand, mostrador, zone.slow);
    const at = (offset: number) => ago(createdAgo - offset);
    orders.push({
      ...baseRow,
      status: "Finalizados",
      accepted_at: at(t.accept),
      ready_at: at(t.ready),
      picked_up_at: at(t.picked),
      delivered_at: at(t.total),
      updated_at: at(t.total),
    });
  }

  return { orders, slowIds };
}

function ratingFrom(x: number): number {
  if (x < 0.05) return 1;
  if (x < 0.1) return 2;
  if (x < 0.2) return 3;
  if (x < 0.55) return 4;
  return 5;
}

function buildExtraReviews(orders: readonly Row[], slowIds: ReadonlySet<string>, rand: Rand): Row[] {
  const finalized = orders.filter((o) => o.status === "Finalizados");
  const chosen = shuffle(finalized, rand).slice(0, EXTRA_REVIEW_COUNT);
  return chosen.map((o, i) => {
    // En zonas lentas la probabilidad de calificación baja sube.
    const boost = slowIds.has(String(o.id)) ? 0.15 : 0;
    const rating = ratingFrom(rand() - boost);
    let feedback: string | null = null;
    if (rating <= 3) feedback = pick(rand, LOW_FEEDBACK);
    else if (rand() < (rating === 4 ? 0.3 : 0.15)) feedback = pick(rand, GOOD_FEEDBACK);
    const deliveredMs = Date.parse(String(o.delivered_at));
    return {
      id: demoId(G.review, 3 + i),
      order_id: o.id,
      client_id: o.client_id,
      rating,
      feedback,
      created_at: new Date(deliveredMs + intIn(rand, 10, 40) * 60_000).toISOString(),
    };
  });
}

export function buildSeed(): Tables {
  const categories: Row[] = CATEGORIES.map((c, i) => ({
    id: demoId(G.cat, i + 1),
    name: c.name,
    description: c.description,
    is_active: true,
    points_per_100: c.points,
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
    points_per_100: null,
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
    wa_marketing_opt_in: i < 4,
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
      channel: "web",
      ...stageSeed(o.status, o.minutesAgo),
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

  // Sugerencias y promociones de ejemplo (editables en Configuración → Promos del día).
  const productId = (name: string) => products.find((p) => p.name === name)?.id ?? null;
  global_config.push({
    key: "promos_del_dia",
    value: [
      { id: "demo-sug-1", tipo: "sugerencia", titulo: "La del chef hoy", descripcion: "Masa madre de 48 h, salsa de tomates asados y mozzarella fresca.", productId: productId("Pizza Margarita"), dias: [], activa: true },
      { id: "demo-promo-1", tipo: "promocion", titulo: "Hoy: la Doble BBQ", descripcion: "Doble carne, panceta crocante y salsa BBQ casera. Ideal para compartir.", productId: productId("Hamburguesa Doble BBQ"), dias: [], activa: true },
      { id: "demo-sug-2", tipo: "sugerencia", titulo: "Para cerrar", descripcion: "El volcán sale tibio, con centro líquido.", productId: productId("Volcán de Cacao"), dias: [], activa: true },
    ],
    updated_at: ago(60),
  });

  const delivery_zones: Row[] = [
    { name: "Zona cercana", radius_km: 3, fee: 600, min_order: 0 },
    { name: "Zona extendida", radius_km: 8, fee: 1000, min_order: 8000 },
  ].map((z, i) => ({
    id: demoId(G.zone, i + 1),
    name: z.name,
    shape: { type: "circle", lat: RESTAURANT_LOCATION.lat, lng: RESTAURANT_LOCATION.lng, radius_km: z.radius_km },
    fee: z.fee,
    min_order: z.min_order,
    sort_order: i,
    is_active: true,
    created_at: ago(60 * 24 * 30),
    updated_at: ago(60 * 24 * 30),
  }));

  const rand = prng(EXTRA_SEED);
  const extra = buildExtraOrders(Date.now(), clients.map((c) => String(c.id)), rand);
  const extraReviews = buildExtraReviews(extra.orders, extra.slowIds, rand);
  const demoZones: Row[] = DEMO_ZONES.map((z, i) => ({
    id: demoId(G.zone, 3 + i),
    name: z.name,
    shape: { type: "polygon", points: boxCorners(z.box) },
    fee: z.fee,
    min_order: z.minOrder,
    sort_order: 2 + i,
    is_active: true,
    created_at: ago(60 * 24 * 30),
    updated_at: ago(60 * 24 * 30),
  }));

  return {
    clients,
    orders: [...orders, ...extra.orders],
    points_ledger, global_config, categories, products,
    reviews: [...reviews, ...extraReviews],
    order_events: [], delivery_zones: [...delivery_zones, ...demoZones],
    integration_secrets: [], wa_conversations: [], wa_messages: [], wa_campaigns: [], legal_acceptances: [], payment_intents: [], order_items: [], courier_locations: [],
    couriers: demoCouriers(),
  };
}
