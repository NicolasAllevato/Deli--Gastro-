"use client";

import { useState } from "react";
import {
  Save, Settings, Star, Bell, Zap, ChevronRight, Plus, Trash2,
} from "lucide-react";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";

type Tab = "general" | "puntos" | "notificaciones";

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "general",        label: "General",        icon: <Settings size={15} /> },
  { id: "puntos",         label: "Puntos",          icon: <Star size={15} /> },
  { id: "notificaciones", label: "Notificaciones",  icon: <Bell size={15} /> },
];

interface Nivel {
  id: string;
  nombre: string;
  desde: number;
  hasta: number | null;
  multiplicador: number;
}

function Toggle({ label, hint, defaultChecked = false }: { label: string; hint?: string; defaultChecked?: boolean }) {
  const [on, setOn] = useState(defaultChecked);
  return (
    <div className="neumorphic-inset rounded-xl px-4 py-3.5 flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-bold text-gray-700">{label}</p>
        {hint && <p className="text-[11px] text-gray-500 mt-0.5">{hint}</p>}
      </div>
      <Switch checked={on} onChange={setOn} aria-label={label} />
    </div>
  );
}

function TabGeneral() {
  const [pausado, setPausado] = useState(false);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field label="Tiempo límite cancelación (min)"
          name="cancellation_time" type="number" defaultValue={15}
          hint="Minutos permitidos para cancelar tras ordenar." />
        <Field label="Link Google Maps"
          name="google_maps_link" type="url" defaultValue="https://maps.google.com/?q=Deli+Gastro"
          hint="Enlace para reseñas y direcciones del local." />
        <Field label="Costo por Km ($)"
          name="cost_per_km" type="number" defaultValue={150}
          hint="Tarifa base logística por kilómetro." />
        <Field label="Tiempo estimado base (min)"
          name="base_delivery_time" type="number" defaultValue={30}
          hint="Tiempo base mostrado al cliente al confirmar pedido." />
      </div>

      <div className="pt-2 border-t border-gray-200/60">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Mantenimiento</p>
        <div className="neumorphic-inset rounded-xl px-4 py-3.5 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-gray-700">Modo Pausa de Pedidos</p>
            <p className="text-[11px] text-gray-500 mt-0.5">Desactiva temporalmente el ingreso de nuevos pedidos.</p>
          </div>
          <Switch checked={pausado} onChange={setPausado} aria-label="Modo Pausa de Pedidos" />
        </div>
      </div>
    </div>
  );
}

function TabPuntos() {
  const [niveles, setNiveles] = useState<Nivel[]>([
    { id: "bronce",  nombre: "Bronce",  desde: 0,    hasta: 149,  multiplicador: 0.5 },
    { id: "plata",   nombre: "Plata",   desde: 150,  hasta: 299,  multiplicador: 1.0 },
    { id: "oro",     nombre: "Oro",     desde: 300,  hasta: 499,  multiplicador: 1.5 },
    { id: "platino", nombre: "Platino", desde: 500,  hasta: null, multiplicador: 2.0 },
  ]);

  const updateNivel = (idx: number, field: keyof Nivel, value: string | number | null) => {
    setNiveles(prev => prev.map((n, i) => i === idx ? { ...n, [field]: value } : n));
  };

  const removeNivel = (idx: number) => {
    setNiveles(prev => prev.filter((_, i) => i !== idx));
  };

  const addNivel = () => {
    setNiveles(prev => [...prev, { id: crypto.randomUUID(), nombre: "Nuevo Nivel", desde: 0, hasta: null, multiplicador: 1 }]);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field label="Puntos por $100 gastado"
          name="points_per_100" type="number" step="0.1" defaultValue={0.5}
          hint="Puntos base que se acumulan por cada $100 del pedido." />
        <Field label="Puntos mínimos por pedido"
          name="min_points" type="number" defaultValue={5}
          hint="Puntos mínimos que otorga cualquier pedido." />
        <Field label="Vencimiento de puntos (días)"
          name="points_expiry_days" type="number" defaultValue={180}
          hint="0 = sin vencimiento." />
        <Field label="Puntos por registro nuevo cliente"
          name="points_signup" type="number" defaultValue={50}
          hint="Bonus de bienvenida al registrarse." />
      </div>

      <div className="pt-2 border-t border-gray-200/60">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Niveles de lealtad</p>
          <button
            type="button"
            onClick={addNivel}
            className="flex items-center gap-1 text-[11px] font-black text-brand-orange hover:text-orange-600 transition-colors"
          >
            <Plus size={13} /> Agregar nivel
          </button>
        </div>
        <div className="space-y-2">
          {niveles.map((nivel, idx) => (
            <div key={nivel.id} className="neumorphic-inset rounded-xl p-3 grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Nombre</label>
                <input
                  type="text" value={nivel.nombre}
                  onChange={e => updateNivel(idx, "nombre", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg neumorphic-inset text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-brand-orange/40"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Desde (pts)</label>
                <input
                  type="number" value={nivel.desde}
                  onChange={e => updateNivel(idx, "desde", Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg neumorphic-inset text-xs text-gray-700 outline-none focus:ring-2 focus:ring-brand-orange/40"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Multiplicador</label>
                <input
                  type="number" step="0.1" value={nivel.multiplicador}
                  onChange={e => updateNivel(idx, "multiplicador", Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg neumorphic-inset text-xs text-gray-700 outline-none focus:ring-2 focus:ring-brand-orange/40"
                />
              </div>
              <button
                type="button"
                onClick={() => removeNivel(idx)}
                className="flex items-center justify-center w-8 h-8 rounded-full neumorphic text-gray-500 hover:text-red-500 transition-colors self-end"
                aria-label={`Eliminar nivel ${nivel.nombre}`}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="pt-2 border-t border-gray-200/60">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Opciones de canje</p>
        <div className="space-y-2">
          {[
            { label: "Postre gratis",  pts: 200, hint: "Cualquier postre del menú" },
            { label: "Bebida gratis",  pts: 150, hint: "Bebida de hasta $2.500" },
            { label: "10% descuento",  pts: 100, hint: "En el próximo pedido" },
            { label: "Envío gratis",   pts: 80,  hint: "Sin costo de delivery" },
          ].map(canje => (
            <div key={canje.label} className="neumorphic-inset rounded-xl px-4 py-3 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-gray-700">{canje.label}</p>
                <p className="text-[11px] text-gray-500">{canje.hint}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <input
                  type="number" defaultValue={canje.pts}
                  className="w-20 px-3 py-1.5 rounded-lg neumorphic-inset text-xs font-bold text-gray-700 outline-none text-center focus:ring-2 focus:ring-brand-orange/40"
                />
                <span className="text-[10px] text-gray-500 font-bold">pts</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TabNotificaciones() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field label="Webhook notificaciones"
          name="notif_webhook" type="url"
          hint="URL n8n para disparar notificaciones push." />
        <Field label="Email remitente"
          name="notif_email_from" type="email" defaultValue="noreply@deli-gastro.com"
          hint="Email desde el que se envían las notificaciones." />
      </div>

      <div className="pt-2 border-t border-gray-200/60 space-y-3">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Disparadores automáticos</p>
        <Toggle label="Notificar cuando el pedido esté listo"
          hint="Envía push al cliente cuando pasa a 'En Camino'." defaultChecked />
        <Toggle label="Notificar cuando los puntos estén por vencer"
          hint="Aviso 7 días antes del vencimiento." defaultChecked />
        <Toggle label="Notificar promos disponibles"
          hint="Avisa al cliente cuando puede canjear una recompensa." />
        <Toggle label="Resumen semanal de puntos"
          hint="Email automático los lunes con el saldo de puntos." />
      </div>

      <div className="pt-2 border-t border-gray-200/60">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Plantilla de mensaje</p>
        <Field
          as="textarea"
          label="Mensaje por defecto (promo)"
          name="notif_template"
          rows={3}
          defaultValue="¡Hola {nombre}! Tenés {puntos} puntos acumulados y podés canjear {promo}. ¡Aprovechalo!"
          hint={"Variables: {nombre} · {puntos} · {promo}"}
        />
      </div>

      <div className="neumorphic-inset rounded-xl p-4 flex items-center gap-3">
        <Zap size={16} className="text-brand-orange shrink-0" />
        <div>
          <p className="text-sm font-bold text-gray-700">Probar notificación</p>
          <p className="text-[11px] text-gray-500">Envía un mensaje de prueba a tu email de administrador.</p>
        </div>
        <Button variant="secondary" size="sm" rightIcon={<ChevronRight size={13} />} className="ml-auto shrink-0">
          Probar
        </Button>
      </div>
    </div>
  );
}

export default function ConfiguracionPage() {
  const [activeTab, setActiveTab] = useState<Tab>("general");
  const [isSaving, setIsSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    setSavedOk(false);
    await new Promise(r => setTimeout(r, 800));
    setIsSaving(false);
    setSavedOk(true);
    setTimeout(() => setSavedOk(false), 3000);
  };

  return (
    <div className="space-y-5 max-w-4xl mx-auto pb-10">

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-headline font-black text-xl text-gray-800 tracking-tight">Configuración</h1>
          <p className="text-gray-500 text-xs mt-0.5">Parámetros de negocio y programa de fidelidad</p>
        </div>
        <Button
          type="button"
          leftIcon={<Save size={14} />}
          size="sm"
          disabled={isSaving}
          onClick={handleSave}
        >
          {isSaving ? "Guardando..." : savedOk ? "¡Guardado!" : "Guardar cambios"}
        </Button>
      </div>

      <div className="neumorphic rounded-2xl p-1.5 flex gap-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-bold transition-all duration-200 ${
              activeTab === tab.id
                ? "neumorphic-inset text-brand-orange"
                : "text-gray-500 hover:text-gray-700 hover:bg-white/40"
            }`}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="neumorphic rounded-2xl p-5 animate-in fade-in duration-150">
        {activeTab === "general"        && <TabGeneral />}
        {activeTab === "puntos"         && <TabPuntos />}
        {activeTab === "notificaciones" && <TabNotificaciones />}
      </div>
    </div>
  );
}
