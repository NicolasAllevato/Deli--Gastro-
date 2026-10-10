"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sendToDispatcher } from "@/utils/api";
import { Wallet, UtensilsCrossed, Timer } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { formatMoney, formatOrderId, isActiveStatus } from "@/lib/orders";
import type { EnrichedOrder } from "@/lib/orders-server";
import type { OrderStatus } from "@/types/database";
import { COLUMNS, KanbanColumn } from "./KanbanColumn";

interface Props {
  initialOrders: EnrichedOrder[];
}

const POLL_MS = 5000;
const MAX_FINISHED_SHOWN = 10;

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

export default function TableroClient({ initialOrders }: Props) {
  const [orders, setOrders] = useState<EnrichedOrder[]>(initialOrders);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newOrderError, setNewOrderError] = useState<string | null>(null);
  const [couriers, setCouriers] = useState<string[]>([]);
  const busyRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    // No pisar el estado optimista mientras hay un cambio en vuelo.
    if (busyRef.current) return;
    try {
      const res = await fetch("/api/orders", { cache: "no-store" });
      if (res.ok && !busyRef.current) setOrders((await res.json()) as EnrichedOrder[]);
    } catch {
      /* sin red: se reintenta en el próximo ciclo */
    }
  }, []);

  // La lista de repartidores casi no cambia: se pide una sola vez.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/couriers", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<string[]>) : []))
      .then((names) => { if (!cancelled) setCouriers(names); })
      .catch(() => { /* sin lista, el selector no se muestra */ });
    return () => { cancelled = true; };
  }, []);

  // Los pedidos del cliente llegan solos: se consulta la lista cada pocos segundos.
  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const stats = useMemo(() => {
    const todays = orders.filter((o) => isToday(o.created_at));
    const finished = todays.filter((o) => o.status === "Finalizados");
    const avg =
      finished.length > 0
        ? Math.round(
            finished.reduce((s, o) => s + (new Date(o.delivered_at ?? o.updated_at).getTime() - new Date(o.created_at).getTime()) / 60000, 0) /
              finished.length,
          )
        : null;
    return {
      ventasHoy: todays.reduce((sum, o) => sum + o.total, 0),
      activos: orders.filter((o) => isActiveStatus(o.status)).length,
      avgMinutes: avg,
    };
  }, [orders]);

  const assignCourier = async (id: string, courierName: string | null) => {
    const previous = orders;
    busyRef.current = id;
    setBusyId(id);
    setMoveError(null);
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, courier_name: courierName } : o)));

    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, courier_name: courierName }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "No se pudo asignar el repartidor.");
      }
    } catch (e: unknown) {
      setOrders(previous);
      setMoveError(e instanceof Error ? e.message : "No se pudo asignar el repartidor.");
    } finally {
      busyRef.current = null;
      setBusyId(null);
      void refresh();
    }
  };

  const moveOrder = async (id: string, newStatus: OrderStatus) => {
    if (newStatus === "Cancelado" && !confirm(`¿Cancelar el pedido ${formatOrderId(id)}?`)) return;

    const previous = orders;
    busyRef.current = id;
    setBusyId(id);
    setMoveError(null);
    setOrders((prev) =>
      newStatus === "Cancelado"
        ? prev.filter((o) => o.id !== id)
        : prev.map((o) => (o.id === id ? { ...o, status: newStatus } : o)),
    );

    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: newStatus }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "No se pudo actualizar el pedido.");
      }
      sendToDispatcher("status_update", {
        orderId: id,
        newStatus,
        timestamp: new Date().toISOString(),
      }).catch(() => null);
    } catch (e: unknown) {
      setOrders(previous);
      setMoveError(e instanceof Error ? e.message : "No se pudo actualizar el pedido.");
    } finally {
      busyRef.current = null;
      setBusyId(null);
      void refresh();
    }
  };

  const handleNewOrderSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setNewOrderError(null);
    const formData = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items_desc: formData.get("items") as string,
          total: Number(formData.get("price")),
        }),
      });

      if (!res.ok) throw new Error("Error al crear pedido");
      const created = (await res.json()) as { id: string; items_desc: string; total: number };
      setIsNewOrderModalOpen(false);
      await refresh();

      sendToDispatcher("new_order", {
        orderId: created.id,
        items: created.items_desc,
        price: formatMoney(created.total),
        customerName: formData.get("customer"),
        timestamp: new Date().toISOString(),
      }).catch(() => null);
    } catch {
      setNewOrderError("No se pudo crear el pedido. Intentá de nuevo.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const ordersFor = (status: OrderStatus) => {
    const list = orders.filter((o) => o.status === status);
    return status === "Finalizados"
      ? [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, MAX_FINISHED_SHOWN)
      : list;
  };

  return (
    <section className="p-2 md:p-3 gap-4 min-h-full h-full flex flex-col">
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 shrink-0">
        <div className="card-3d px-4 py-3 neumorphic rounded-2xl flex items-center justify-between group fade-up-1">
          <div>
            <p className="text-gray-500 text-[11px] font-bold uppercase tracking-widest mb-1">Ventas Hoy</p>
            <h3 className="text-xl font-headline font-black text-gray-800">{formatMoney(stats.ventasHoy)}</h3>
          </div>
          <div className="w-10 h-10 rounded-full neumorphic-inset flex items-center justify-center text-brand-orange shrink-0 group-hover:scale-110 transition-transform duration-300">
            <Wallet size={20} aria-hidden />
          </div>
        </div>
        <div className="card-3d px-4 py-3 neumorphic rounded-2xl flex items-center justify-between group fade-up-2">
          <div>
            <p className="text-gray-500 text-[11px] font-bold uppercase tracking-widest mb-1">Pedidos Activos</p>
            <h3 className="text-xl font-headline font-black text-gray-800">{stats.activos}</h3>
          </div>
          <div className="w-10 h-10 rounded-full neumorphic-inset flex items-center justify-center text-brand-green shrink-0 group-hover:scale-110 transition-transform duration-300">
            <UtensilsCrossed size={20} aria-hidden />
          </div>
        </div>
        <div className="card-3d px-4 py-3 neumorphic rounded-2xl flex items-center justify-between group fade-up-3">
          <div>
            <p className="text-gray-500 text-[11px] font-bold uppercase tracking-widest mb-1">Promedio Entrega</p>
            <h3 className="text-xl font-headline font-black text-gray-800">
              {stats.avgMinutes === null ? "—" : `${stats.avgMinutes} min`}
            </h3>
          </div>
          <div className="w-10 h-10 rounded-full neumorphic-inset flex items-center justify-center text-gray-600 shrink-0 group-hover:scale-110 transition-transform duration-300">
            <Timer size={20} aria-hidden />
          </div>
        </div>
      </div>

      {/* Kanban */}
      <div className="flex flex-col gap-3 flex-1 min-h-[28rem]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-2 shrink-0">
          <h2 className="font-headline font-bold text-lg text-gray-800 tracking-tight">Órdenes en tiempo real</h2>
          <div className="flex gap-3">
            <Button size="sm" onClick={() => setIsNewOrderModalOpen(true)}>+ Nuevo Pedido</Button>
          </div>
        </div>

        {moveError && (
          <p role="alert" className="text-xs font-bold text-red-600 px-3 py-2 rounded-lg bg-red-50 border border-red-100 shrink-0">
            {moveError}
          </p>
        )}

        <div className="flex lg:grid lg:grid-cols-4 gap-3 overflow-x-auto lg:overflow-x-visible overflow-y-hidden flex-1 min-h-0 items-stretch snap-x snap-mandatory lg:snap-none px-1 pb-2">
          {COLUMNS.map((column) => (
            <KanbanColumn
              key={column.status}
              config={column}
              orders={ordersFor(column.status)}
              busyId={busyId}
              onMove={moveOrder}
              couriers={couriers}
              onAssign={assignCourier}
            />
          ))}
        </div>
      </div>

      {/* Modal: Nuevo Pedido (mostrador) */}
      <Modal
        open={isNewOrderModalOpen}
        onClose={() => { setIsNewOrderModalOpen(false); setNewOrderError(null); }}
        title="Nuevo Pedido"
        footer={
          <Button type="submit" form="new-order-form" fullWidth disabled={isSubmitting}>
            {isSubmitting ? "Creando..." : "Crear Pedido"}
          </Button>
        }
      >
        <form id="new-order-form" onSubmit={handleNewOrderSubmit} className="space-y-5">
          <Field label="Nombre del Cliente" name="customer" type="text" placeholder="Ej. Juan Pérez" />
          <Field label="Ítems (Descripción)" name="items" type="text" required placeholder="Ej. 2x Hamburguesa Clásica" />
          <Field label="Precio Total ($)" name="price" type="number" step="100" required placeholder="Ej. 3500" />
          {newOrderError && (
            <p role="alert" className="text-xs font-bold text-red-600 px-3 py-2 rounded-lg bg-red-50 border border-red-100">
              {newOrderError}
            </p>
          )}
        </form>
      </Modal>
    </section>
  );
}
