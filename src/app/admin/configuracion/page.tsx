"use client";

import { useState, useEffect, useCallback, type ReactNode, type Dispatch, type SetStateAction } from "react";
import {
  Save, Settings, Star, Bell, Zap, ChevronRight, Plus, Trash2,
} from "lucide-react";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";

type Tab = "general" | "puntos" | "notificaciones";

const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "general",        label: "General",       icon: <Settings size={15} /> },
  { id: "puntos",         label: "Puntos",         icon: <Star size={15} /> },
  { id: "notificaciones", label: "Notificaciones", icon: <Bell size={15} /> },
];

interface Nivel {
  id: string;
  nombre: string;
  desde: number;
  hasta: number | null;
  multiplicador: number;
}

interface ConfigState {
  cancelacion_min: number;
  google_maps_url: string;
  costo_por_km: number;
  tiempo_entrega_min: number;
  modo_pausa: boolean;
  puntos_por_100: number;
  puntos_minimos: number;
  puntos_vencimiento_dias: number;
  puntos_bienvenida: number;
  notif_webhook: string;
  notif_email_from: string;
  notif_template: string;
}

const DEFAULT_CONFIG: ConfigState = {
  cancelacion_min: 15,
  google_maps_url: "https://maps.google.com/?q=Deli+Gastro",
  costo_por_km: 150,
  tiempo_entrega_min: 30,
  modo_pausa: false,
  puntos_por_100: 0.5,
  puntos_minimos: 5,
  puntos_vencimiento_dias: 180,
  puntos_bienvenida: 50,
  notif_webhook: "",
  notif_email_from: "noreply@deli-gastro.com",
  notif_template: "¡Hola {nombre}! Tenés {puntos} puntos acumulados y podés canjear {promo}. ¡Aprovechalo!",
};

const DEFAULT_NIVELES: Nivel[] = [
  { id: "bronce",  nombre: "Bronce",  desde: 0,   hasta: 149,  multiplicador: 0.5 },
  { id: "plata",   nombre: "Plata",   desde: 150, hasta: 299,  multiplicador: 1.0 },
  { id: "oro",     nombre: "Oro",     desde: 300, hasta: 499,  multiplicador: 1.5 },
  { id: "platino", nombre: "Platino", desde: 500, hasta: null, multiplicador: 2.0 },
];

function TabGeneral({
  config,
  onChange,
}: {
  config: ConfigState;
  onChange: (k: keyof ConfigState, v: unknown) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field
          label="Tiempo límite cancelación (min)"
          name="cancelacion_min"
          type="number"
          value={config.cancelacion_min}
          onChange={e => onChange("cancelacion_min", Number(e.target.value))}
          hint="Minutos permitidos para cancelar tras ordenar."
        />
        <Field
          label="Link Google Maps"
          name="google_maps_url"
          type="url"
          value={config.google_maps_url}
          onChange={e => onChange("google_maps_url", e.target.value)}
          hint="Enlace para reseñas y direcciones del local."
        />
        <Field
          label="Costo por Km ($)"
          name="costo_por_km"
          type="number"
          value={config.costo_por_km}
          onChange={e => onChange("costo_por_km", Number(e.target.value))}
          hint="Tarifa base logística por kilómetro."
        />
        <Field
          label="Tiempo estimado base (min)"
          name="tiempo_entrega_min"
          type="number"
          value={config.tiempo_entrega_min}
          onChange={e => onChange("tiempo_entrega_min", Number(e.target.value))}
          hint="Tiempo base mostrado al cliente al confirmar pedido."
        />
      </div>

      <div className="pt-2 border-t border-gray-200/60">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Mantenimiento</p>
        <div className="neumorphic-inset rounded-xl px-4 py-3.5 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-gray-700">Modo Pausa de Pedidos</p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Desactiva temporalmente el ingreso de nuevos pedidos.
            </p>
          </div>
          <Switch
            checked={config.modo_pausa}
            onChange={v => onChange("modo_pausa", v)}
            aria-label="Modo Pausa de Pedidos"
          />
        </div>
      </div>
    </div>
  );
}

function TabPuntos({
  config,
  onChange,
  niveles,
  setNiveles,
}: {
  config: ConfigState;
  onChange: (k: keyof ConfigState, v: unknown) => void;
  niveles: Nivel[];
  setNiveles: Dispatch<SetStateAction<Nivel[]>>;
}) {
  const updateNivel = (idx: number, field: keyof Nivel, value: string | number | null) => {
    setNiveles(prev => prev.map((n, i) => (i === idx ? { ...n, [field]: value } : n)));
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field
          label="Puntos por $100 gastado"
          name="puntos_por_100"
          type="number"
          step="0.1"
          value={config.puntos_por_100}
          onChange={e => onChange("puntos_por_100", Number(e.target.value))}
          hint="Puntos base que se acumulan por cada $100 del pedido."
        />
        <Field
          label="Puntos mínimos por pedido"
          name="puntos_minimos"
          type="number"
          value={config.puntos_minimos}
          onChange={e => onChange("puntos_minimos", Number(e.target.value))}
          hint="Puntos mínimos que otorga cualquier pedido."
        />
        <Field
          label="Vencimiento de puntos (días)"
          name="puntos_vencimiento_dias"
          type="number"
          value={config.puntos_vencimiento_dias}
          onChange={e => onChange("puntos_vencimiento_dias", Number(e.target.value))}
          hint="0 = sin vencimiento."
        />
        <Field
          label="Puntos por registro nuevo cliente"
          name="puntos_bienvenida"
          type="number"
          value={config.puntos_bienvenida}
          onChange={e => onChange("puntos_bienvenida", Number(e.target.value))}
          hint="Bonus de bienvenida al registrarse."
        />
      </div>

      <div className="pt-2 border-t border-gray-200/60">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Niveles de lealtad</p>
          <button
            type="button"
            onClick={() => setNiveles(prev => [
              ...prev,
              { id: crypto.randomUUID(), nombre: "Nuevo Nivel", desde: 0, hasta: null, multiplicador: 1 },
            ])}
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
                  type="text"
                  value={nivel.nombre}
                  onChange={e => updateNivel(idx, "nombre", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg neumorphic-inset text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-brand-orange/40"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Desde (pts)</label>
                <input
                  type="number"
                  value={nivel.desde}
                  onChange={e => updateNivel(idx, "desde", Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg neumorphic-inset text-xs text-gray-700 outline-none focus:ring-2 focus:ring-brand-orange/40"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Multiplicador</label>
                <input
                  type="number"
                  step="0.1"
                  value={nivel.multiplicador}
                  onChange={e => updateNivel(idx, "multiplicador", Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg neumorphic-inset text-xs text-gray-700 outline-none focus:ring-2 focus:ring-brand-orange/40"
                />
              </div>
              <button
                type="button"
                onClick={() => setNiveles(prev => prev.filter((_, i) => i !== idx))}
                className="flex items-center justify-center w-8 h-8 rounded-full neumorphic text-gray-500 hover:text-red-500 transition-colors self-end"
                aria-label={`Eliminar nivel ${nivel.nombre}`}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TabNotificaciones({
  config,
  onChange,
}: {
  config: ConfigState;
  onChange: (k: keyof ConfigState, v: unknown) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field
          label="Webhook notificaciones"
          name="notif_webhook"
          type="url"
          value={config.notif_webhook}
          onChange={e => onChange("notif_webhook", e.target.value)}
          hint="URL para disparar notificaciones push (n8n o Cloudflare Worker)."
        />
        <Field
          label="Email remitente"
          name="notif_email_from"
          type="email"
          value={config.notif_email_from}
          onChange={e => onChange("notif_email_from", e.target.value)}
          hint="Email desde el que se envían las notificaciones."
        />
      </div>

      <div className="pt-2 border-t border-gray-200/60 space-y-3">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Disparadores automáticos</p>
        {[
          { label: "Notificar cuando el pedido esté listo",    hint: "Envía push al cliente cuando pasa a 'En Camino'.", def: true },
          { label: "Notificar cuando los puntos estén por vencer", hint: "Aviso 7 días antes del vencimiento.", def: true },
          { label: "Notificar promos disponibles",             hint: "Avisa al cliente cuando puede canjear una recompensa.", def: false },
          { label: "Resumen semanal de puntos",                hint: "Email automático los lunes con el saldo de puntos.", def: false },
        ].map(t => <ToggleRow key={t.label} label={t.label} hint={t.hint} defaultChecked={t.def} />)}
      </div>

      <div className="pt-2 border-t border-gray-200/60">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Plantilla de mensaje</p>
        <Field
          as="textarea"
          label="Mensaje por defecto (promo)"
          name="notif_template"
          rows={3}
          value={config.notif_template}
          onChange={e => onChange("notif_template", e.target.value)}
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

function ToggleRow({ label, hint, defaultChecked = false }: { label: string; hint?: string; defaultChecked?: boolean }) {
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

export default function ConfiguracionPage() {
  const [activeTab, setActiveTab] = useState<Tab>("general");
  const [config, setConfig] = useState<ConfigState>(DEFAULT_CONFIG);
  const [niveles, setNiveles] = useState<Nivel[]>(DEFAULT_NIVELES);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then(r => r.json())
      .then((data: Record<string, unknown>) => {
        setConfig({
          cancelacion_min:         Number(data.cancelacion_min         ?? DEFAULT_CONFIG.cancelacion_min),
          google_maps_url:         String(data.google_maps_url         ?? DEFAULT_CONFIG.google_maps_url),
          costo_por_km:            Number(data.costo_por_km            ?? DEFAULT_CONFIG.costo_por_km),
          tiempo_entrega_min:      Number(data.tiempo_entrega_min      ?? DEFAULT_CONFIG.tiempo_entrega_min),
          modo_pausa:              Boolean(data.modo_pausa             ?? DEFAULT_CONFIG.modo_pausa),
          puntos_por_100:          Number(data.puntos_por_100          ?? DEFAULT_CONFIG.puntos_por_100),
          puntos_minimos:          Number(data.puntos_minimos          ?? DEFAULT_CONFIG.puntos_minimos),
          puntos_vencimiento_dias: Number(data.puntos_vencimiento_dias ?? DEFAULT_CONFIG.puntos_vencimiento_dias),
          puntos_bienvenida:       Number(data.puntos_bienvenida       ?? DEFAULT_CONFIG.puntos_bienvenida),
          notif_webhook:           String(data.notif_webhook           ?? DEFAULT_CONFIG.notif_webhook),
          notif_email_from:        String(data.notif_email_from        ?? DEFAULT_CONFIG.notif_email_from),
          notif_template:          String(data.notif_template          ?? DEFAULT_CONFIG.notif_template),
        });
        if (Array.isArray(data.niveles_lealtad)) {
          setNiveles(data.niveles_lealtad as Nivel[]);
        }
      })
      .catch(() => { /* usa defaults */ })
      .finally(() => setIsLoading(false));
  }, []);

  const handleChange = useCallback((k: keyof ConfigState, v: unknown) => {
    setConfig(prev => ({ ...prev, [k]: v }));
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setSavedOk(false);
    try {
      const payload: Record<string, unknown> = {
        ...config,
        niveles_lealtad: niveles,
      };
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setSavedOk(true);
        setTimeout(() => setSavedOk(false), 3000);
      }
    } finally {
      setIsSaving(false);
    }
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
          disabled={isSaving || isLoading}
          onClick={handleSave}
        >
          {isSaving ? "Guardando..." : savedOk ? "¡Guardado!" : "Guardar cambios"}
        </Button>
      </div>

      <div role="tablist" aria-label="Secciones de configuración" className="neumorphic rounded-2xl p-1.5 flex gap-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`tabpanel-${tab.id}`}
            id={`tab-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-bold transition-all duration-200 ${
              activeTab === tab.id
                ? "neumorphic-inset text-brand-orange"
                : "text-gray-500 hover:text-gray-700 hover:bg-white/40"
            }`}
          >
            {tab.icon}
            <span className="text-[10px] xs:text-xs sm:text-xs">{tab.label}</span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="neumorphic rounded-2xl p-10 text-center">
          <p className="text-gray-500 text-sm">Cargando configuración...</p>
        </div>
      ) : (
        <div
          role="tabpanel"
          id={`tabpanel-${activeTab}`}
          aria-labelledby={`tab-${activeTab}`}
          className="neumorphic rounded-2xl p-5 animate-in fade-in duration-150"
        >
          {activeTab === "general" && (
            <TabGeneral config={config} onChange={handleChange} />
          )}
          {activeTab === "puntos" && (
            <TabPuntos config={config} onChange={handleChange} niveles={niveles} setNiveles={setNiveles} />
          )}
          {activeTab === "notificaciones" && (
            <TabNotificaciones config={config} onChange={handleChange} />
          )}
        </div>
      )}
    </div>
  );
}
