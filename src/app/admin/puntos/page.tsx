export const dynamic = 'force-dynamic';

import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import PuntosClient, { type ClientePuntos } from "./PuntosClient";
import PuntosCatalogo, { type CategoriaPuntos, type ProductoPuntos } from "./PuntosCatalogo";
import type { ClientTier } from "@/types/database";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default async function AdminPuntosPage({ searchParams }: { searchParams: Promise<{ cliente?: string | string[] }> }) {
  const raw = (await searchParams).cliente;
  const clienteId = z.string().uuid().safeParse(Array.isArray(raw) ? raw[0] : raw);
  const supabase = createAdminClient();

  const [{ data: clients }, { data: ledger }, { data: categories }, { data: products }, { data: orders }] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, phone, channel, total_points, tier")
      .order("total_points", { ascending: false })
      .order("name")
      .limit(5000),
    supabase
      .from("points_ledger")
      .select("id, client_id, delta, description, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("categories").select("id, name, points_per_100").order("name"),
    supabase.from("products").select("id, name, price, category_id, points_per_100").order("name"),
    // Actividad real de cada cliente (pedidos de la app y de Fudo ya vinculados).
    supabase
      .from("orders")
      .select("client_id, total, created_at")
      .not("client_id", "is", null)
      .neq("status", "Cancelado")
      .order("created_at", { ascending: false })
      .limit(5000),
  ]);

  const activity = new Map<string, { count: number; spent: number; last: string }>();
  for (const o of orders ?? []) {
    if (!o.client_id) continue;
    const prev = activity.get(o.client_id);
    activity.set(o.client_id, {
      count: (prev?.count ?? 0) + 1,
      spent: (prev?.spent ?? 0) + Number(o.total),
      last: prev?.last ?? o.created_at,
    });
  }

  const toRate = (v: number | string | null) => (v === null ? null : Number(v));
  const categorias: CategoriaPuntos[] = (categories ?? []).map((c) => ({
    id: c.id,
    nombre: c.name,
    puntosPor100: toRate(c.points_per_100),
  }));
  const productos: ProductoPuntos[] = (products ?? []).map((p) => ({
    id: p.id,
    nombre: p.name,
    precio: Number(p.price),
    categoriaId: p.category_id ?? null,
    puntosPor100: toRate(p.points_per_100),
  }));

  const ledgerMap: Record<string, typeof ledger> = {};
  for (const entry of ledger ?? []) {
    if (!ledgerMap[entry.client_id]) ledgerMap[entry.client_id] = [];
    ledgerMap[entry.client_id]!.push(entry);
  }

  const clientes: ClientePuntos[] = (clients ?? []).map(c => ({
    id: c.id,
    nombre: c.name,
    telefono: c.phone ?? null,
    canal: c.channel ?? null,
    pedidosTotales: activity.get(c.id)?.count ?? 0,
    gastado: activity.get(c.id)?.spent ?? 0,
    ultimoPedido: activity.get(c.id) ? formatDate(activity.get(c.id)!.last) : null,
    puntosTotales: c.total_points,
    nivel: c.tier as ClientTier,
    pedidos: (ledgerMap[c.id] ?? []).map(e => ({
      id: e.id,
      fecha: formatDate(e.created_at),
      items: e.description,
      puntos: e.delta,
    })),
  }));

  return (
    <div className="space-y-5">
      <PuntosCatalogo categorias={categorias} productos={productos} />
      <PuntosClient clientes={clientes} initialClientId={clienteId.success ? clienteId.data : null} />
    </div>
  );
}
