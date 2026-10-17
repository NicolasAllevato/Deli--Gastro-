export const dynamic = 'force-dynamic';

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

export default async function AdminPuntosPage() {
  const supabase = createAdminClient();

  const [{ data: clients }, { data: ledger }, { data: categories }, { data: products }] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, total_points, tier")
      .order("total_points", { ascending: false }),
    supabase
      .from("points_ledger")
      .select("id, client_id, delta, description, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("categories").select("id, name, points_per_100").order("name"),
    supabase.from("products").select("id, name, price, category_id, points_per_100").order("name"),
  ]);

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
      <PuntosClient clientes={clientes} />
    </div>
  );
}
