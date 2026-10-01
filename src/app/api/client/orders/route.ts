import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireClient } from "@/lib/auth/requireClient";
import { isAuthorizationError } from "@/lib/auth/requireRole";
import { buildItemsDesc, PAYMENT_METHODS } from "@/lib/orders";
import { numberConfig, readConfig } from "@/lib/orders-server";
import { RESTAURANT_LOCATION, calcDeliveryFee, haversineKm } from "@/lib/restaurant";

const createSchema = z.object({
  items: z
    .array(z.object({ productId: z.string().uuid(), qty: z.number().int().min(1).max(20) }))
    .min(1, "El carrito está vacío")
    .max(30),
  address: z.object({
    address: z.string().trim().min(5, "Indicá la dirección de entrega").max(200),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  paymentMethod: z.enum(PAYMENT_METHODS),
  notes: z.string().trim().max(300).optional(),
});

/** Pedidos del cliente autenticado (más recientes primero). */
export async function GET(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 200, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const auth = await requireClient();
  if (isAuthorizationError(auth)) return auth.error;

  const { data, error } = await createAdminClient()
    .from("orders")
    .select("*")
    .eq("client_id", auth.client.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/**
 * Checkout. El cliente sólo manda ids y cantidades: precios, subtotal y
 * costo de envío se recalculan acá contra `products` y `global_config`.
 */
export async function POST(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 10, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const auth = await requireClient();
  if (isAuthorizationError(auth)) return auth.error;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Body inválido." }, { status: 400 });
  }
  const { items, address, paymentMethod, notes } = parsed.data;

  const db = createAdminClient();
  const config = await readConfig(db);

  if (config.modo_pausa === true || config.tienda_activa === false) {
    return NextResponse.json({ error: "El local no está tomando pedidos en este momento." }, { status: 409 });
  }

  const distanceKm = haversineKm(RESTAURANT_LOCATION, address);
  const radius = numberConfig(config, "radio_delivery_km", 8);
  if (distanceKm > radius) {
    return NextResponse.json(
      { error: `Tu dirección está fuera de la zona de entrega (${radius} km).` },
      { status: 400 },
    );
  }

  const qtyByProduct = new Map<string, number>();
  for (const item of items) {
    qtyByProduct.set(item.productId, (qtyByProduct.get(item.productId) ?? 0) + item.qty);
  }

  const { data: products, error: productsError } = await db
    .from("products")
    .select("id, name, price, is_active")
    .in("id", [...qtyByProduct.keys()]);
  if (productsError) return NextResponse.json({ error: productsError.message }, { status: 500 });

  const lines = [];
  let subtotal = 0;
  for (const [productId, qty] of qtyByProduct) {
    const product = (products ?? []).find((p) => p.id === productId);
    if (!product || !product.is_active) {
      return NextResponse.json({ error: "Un producto del carrito ya no está disponible." }, { status: 400 });
    }
    subtotal += Number(product.price) * qty;
    lines.push({ qty, name: product.name });
  }

  const deliveryFee = calcDeliveryFee(distanceKm, numberConfig(config, "costo_por_km", 150));

  const { data: order, error } = await db
    .from("orders")
    .insert({
      client_id: auth.client.id,
      status: "Recibidos",
      items_desc: buildItemsDesc(lines),
      total: subtotal + deliveryFee,
      delivery_fee: deliveryFee,
      delivery_address: address.address,
      delivery_lat: address.lat,
      delivery_lng: address.lng,
      payment_method: paymentMethod,
      notes: notes || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(order, { status: 201 });
}
