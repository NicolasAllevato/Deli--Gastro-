"use client";

import { useState } from "react";
import { sendToDispatcher } from "@/utils/api";
import { Wallet, UtensilsCrossed, Timer, History, Flame, Bike } from "lucide-react";
import { mockOrders, type MockOrder, type OrderStatus } from "@/fixtures/orders";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

export default function AdminTableroPage() {
  const [orders, setOrders] = useState<MockOrder[]>(mockOrders);
  const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState(false);

  const moveOrder = async (id: string, newStatus: OrderStatus) => {
    const previousOrders = orders;
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status: newStatus } : o)));

    try {
      await sendToDispatcher("status_update", {
        orderId: id,
        newStatus,
        timestamp: new Date().toISOString(),
      });
    } catch {
      setOrders(previousOrders);
    }
  };

  const handleNewOrderSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const newOrder: MockOrder = {
      id: `#${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      items: formData.get("items") as string,
      time: "00:00 min",
      status: "Recibidos",
      price: `$ ${formData.get("price")}`,
      minutesAgo: 0,
    };

    setOrders((prev) => [newOrder, ...prev]);
    setIsNewOrderModalOpen(false);

    try {
      await sendToDispatcher("new_order", {
        orderId: newOrder.id,
        items: newOrder.items,
        price: newOrder.price,
        customerName: formData.get("customer"),
        timestamp: new Date().toISOString(),
      });
    } catch {
      // El pedido ya fue añadido localmente — el error de backend no revierte la UI
    }
  };

  const getOrders = (status: OrderStatus) => orders.filter((o) => o.status === status);

  return (
    <section className="p-6 md:p-8 space-y-8 h-full flex flex-col">
      {/* KPI Section */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 shrink-0">
        <div className="card-3d p-4 neumorphic rounded-2xl flex items-center justify-between group fade-up-1">
          <div>
            <p className="text-gray-500 text-[11px] font-bold uppercase tracking-widest mb-1">Ventas Hoy</p>
            <h3 className="text-xl font-headline font-black text-gray-800">$ 45.200</h3>
          </div>
          <div className="w-10 h-10 rounded-full neumorphic-inset flex items-center justify-center text-brand-orange shrink-0 group-hover:scale-110 transition-transform duration-300">
            <Wallet size={20} />
          </div>
        </div>
        <div className="card-3d p-4 neumorphic rounded-2xl flex items-center justify-between group fade-up-2">
          <div>
            <p className="text-gray-500 text-[11px] font-bold uppercase tracking-widest mb-1">Pedidos Activos</p>
            <h3 className="text-xl font-headline font-black text-gray-800">{getOrders("Recibidos").length + getOrders("En Preparación").length + getOrders("En Camino").length}</h3>
          </div>
          <div className="w-10 h-10 rounded-full neumorphic-inset flex items-center justify-center text-brand-green shrink-0 group-hover:scale-110 transition-transform duration-300">
            <UtensilsCrossed size={20} />
          </div>
        </div>
        <div className="card-3d p-4 neumorphic rounded-2xl flex items-center justify-between group fade-up-3">
          <div>
            <p className="text-gray-500 text-[11px] font-bold uppercase tracking-widest mb-1">Promedio Entrega</p>
            <h3 className="text-xl font-headline font-black text-gray-800">28 min</h3>
          </div>
          <div className="w-10 h-10 rounded-full neumorphic-inset flex items-center justify-center text-gray-600 shrink-0 group-hover:scale-110 transition-transform duration-300">
            <Timer size={20} />
          </div>
        </div>
      </div>

      {/* Kanban Section */}
      <div className="flex flex-col gap-4 flex-1 min-h-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-2 shrink-0">
          <h2 className="font-headline font-bold text-lg text-gray-800 tracking-tight">Órdenes en tiempo real</h2>
          <div className="flex gap-3">
            <Button variant="secondary" size="sm">Historial</Button>
            <Button size="sm" onClick={() => setIsNewOrderModalOpen(true)}>
              + Nuevo Pedido
            </Button>
          </div>
        </div>

        {/* Kanban Board */}
        <div className="flex gap-4 overflow-x-auto overflow-y-hidden pb-4 h-full items-start snap-x snap-mandatory px-1">

          {/* Columna: Recibidos */}
          <div className="w-[85vw] sm:w-[260px] lg:w-[280px] xl:w-[300px] shrink-0 snap-start neumorphic-inset rounded-2xl p-4 flex flex-col gap-3 max-h-full overflow-y-auto">
            <div className="flex items-center justify-between px-1 mb-1 sticky top-0 bg-inset z-10 py-1.5">
              <span className="flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.6)]" />
                <span className="text-sm font-black uppercase tracking-widest text-gray-700">Recibidos</span>
              </span>
              <span className="neumorphic px-3 py-1 rounded-lg text-xs font-black text-gray-800">{getOrders("Recibidos").length.toString().padStart(2, "0")}</span>
            </div>

            {getOrders("Recibidos").map(order => (
              <div key={order.id} className="neumorphic p-4 rounded-2xl space-y-3 transition-transform hover:-translate-y-0.5">
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <h4 className="font-headline font-bold text-sm text-gray-800">{order.id}</h4>
                    <p className="text-xs text-gray-500 mt-0.5">{order.items}</p>
                  </div>
                  <span className="text-sm font-black text-brand-orange shrink-0">{order.price}</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-red-600 bg-red-50 w-fit px-2.5 py-1 rounded-full border border-red-100">
                  <History size={14} />
                  hace {order.minutesAgo} min
                </div>
                <button
                  onClick={() => moveOrder(order.id, "En Preparación")}
                  className="w-full py-2 rounded-xl neumorphic-inset text-brand-orange hover:text-orange-600 transition-all font-bold text-xs"
                >
                  Aceptar Pedido
                </button>
              </div>
            ))}
          </div>

          {/* Columna: En Preparación */}
          <div className="w-[85vw] sm:w-[260px] lg:w-[280px] xl:w-[300px] shrink-0 snap-start neumorphic-inset rounded-2xl p-4 flex flex-col gap-3 max-h-full overflow-y-auto">
            <div className="flex items-center justify-between px-1 mb-1 sticky top-0 bg-inset z-10 py-1.5">
              <span className="flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.6)]" />
                <span className="text-sm font-black uppercase tracking-widest text-gray-700">Preparación</span>
              </span>
              <span className="neumorphic px-3 py-1 rounded-lg text-xs font-black text-gray-800">{getOrders("En Preparación").length.toString().padStart(2, "0")}</span>
            </div>

            {getOrders("En Preparación").map(order => (
              <div key={order.id} className="neumorphic p-4 rounded-2xl space-y-3">
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <h4 className="font-headline font-bold text-sm text-gray-800">{order.id}</h4>
                    <p className="text-xs text-gray-500 mt-0.5">{order.items}</p>
                  </div>
                  <span className="text-sm font-black text-brand-orange shrink-0">{order.price}</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-yellow-700 bg-yellow-50 w-fit px-2.5 py-1 rounded-full border border-yellow-100">
                  <Flame size={14} />
                  hace {order.minutesAgo} min
                </div>
                <button
                  onClick={() => moveOrder(order.id, "En Camino")}
                  className="w-full py-2 rounded-xl neumorphic-inset text-yellow-600 hover:text-yellow-700 transition-all font-bold text-xs"
                >
                  Listo para Enviar
                </button>
              </div>
            ))}
          </div>

          {/* Columna: En Camino */}
          <div className="w-[85vw] sm:w-[260px] lg:w-[280px] xl:w-[300px] shrink-0 snap-start neumorphic-inset rounded-2xl p-4 flex flex-col gap-3 max-h-full overflow-y-auto">
            <div className="flex items-center justify-between px-1 mb-1 sticky top-0 bg-inset z-10 py-1.5">
              <span className="flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.6)]" />
                <span className="text-sm font-black uppercase tracking-widest text-gray-700">En Camino</span>
              </span>
              <span className="neumorphic px-3 py-1 rounded-lg text-xs font-black text-gray-800">{getOrders("En Camino").length.toString().padStart(2, "0")}</span>
            </div>

            {getOrders("En Camino").map(order => (
              <div key={order.id} className="neumorphic p-4 rounded-2xl space-y-3">
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <h4 className="font-headline font-bold text-sm text-gray-800">{order.id}</h4>
                    <p className="text-xs text-gray-500 mt-0.5">{order.items}</p>
                  </div>
                  <span className="text-sm font-black text-brand-orange shrink-0">{order.price}</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-blue-700 bg-blue-50 w-fit px-2.5 py-1 rounded-full border border-blue-100">
                  <Bike size={14} />
                  hace {order.minutesAgo} min
                </div>
                <button
                  onClick={() => moveOrder(order.id, "Finalizados")}
                  className="w-full py-2 rounded-xl bg-brand-orange text-white shadow-[0_3px_8px_rgba(255,123,0,0.3)] hover:bg-orange-600 transition-all font-bold text-xs"
                >
                  Entregado
                </button>
              </div>
            ))}
          </div>

          {/* Columna: Finalizados */}
          <div className="w-[85vw] sm:w-[260px] lg:w-[280px] xl:w-[300px] shrink-0 snap-start neumorphic-inset rounded-2xl p-4 flex flex-col gap-3 max-h-full overflow-y-auto">
            <div className="flex items-center justify-between px-1 mb-1 sticky top-0 bg-inset z-10 py-1.5">
              <span className="flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-brand-green shadow-[0_0_10px_rgba(75,253,57,0.6)]" />
                <span className="text-sm font-black uppercase tracking-widest text-gray-700">Finalizados</span>
              </span>
              <span className="neumorphic px-3 py-1 rounded-lg text-xs font-black text-gray-800">{getOrders("Finalizados").length.toString().padStart(2, "0")}</span>
            </div>

            {getOrders("Finalizados").length === 0 ? (
              <div className="h-32 flex items-center justify-center neumorphic-inset rounded-2xl p-6 text-center">
                <p className="text-sm font-bold text-gray-500">Sin pedidos finalizados</p>
              </div>
            ) : (
              getOrders("Finalizados").map(order => (
                <div key={order.id} className="neumorphic p-5 rounded-2xl space-y-4 opacity-70 grayscale">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-headline font-bold text-lg text-gray-800 line-through">{order.id}</h4>
                      <p className="text-sm text-gray-500 font-medium">{order.items}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Modal: Nuevo Pedido */}
      <Modal
        open={isNewOrderModalOpen}
        onClose={() => setIsNewOrderModalOpen(false)}
        title="Nuevo Pedido"
        footer={
          <Button type="submit" form="new-order-form" fullWidth>
            Crear Pedido
          </Button>
        }
      >
        <form id="new-order-form" onSubmit={handleNewOrderSubmit} className="space-y-5">
          <Field
            label="Nombre del Cliente"
            name="customer"
            type="text"
            required
            placeholder="Ej. Juan Pérez"
          />
          <Field
            label="Ítems (Descripción)"
            name="items"
            type="text"
            required
            placeholder="Ej. 2 items • Delivery"
          />
          <Field
            label="Precio Total ($)"
            name="price"
            type="number"
            step="100"
            required
            placeholder="Ej. 3500"
          />
        </form>
      </Modal>
    </section>
  );
}
