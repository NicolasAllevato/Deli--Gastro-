"use client";

import { useEffect, useState } from "react";
import { Mail, MessageCircle, Plus, Save, Send, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/Switch";
import {
  DAILY_SUMMARY_KEY,
  DAILY_SUMMARY_LAST_KEY,
  MAX_RECIPIENTS,
  dailySummarySettingsSchema,
  parseLastSend,
  parseSettings,
  type DailySummarySettings,
  type LastSend,
  type Recipient,
} from "@/lib/daily-summary/settings";

interface ChannelResult { sent: number; failed: number; status: "enviado" | "sin-configurar" | "sin-destinatarios" }
interface TestResult { date: string; email: ChannelResult; whatsapp: ChannelResult }

const inputClass = "w-full rounded-2xl px-4 py-2.5 text-sm text-gray-800 bg-white border border-gray-300";

const newRecipient = (): Recipient => ({
  id: crypto.randomUUID().slice(0, 12),
  nombre: "",
  email: "",
  telefono: "",
  activo: true,
});

function describe(label: string, r: ChannelResult): string {
  if (r.status === "sin-configurar") return `${label}: sin configurar en el servidor`;
  if (r.status === "sin-destinatarios") return `${label}: nadie con ese dato cargado`;
  return `${label}: ${r.sent} enviado(s)${r.failed ? `, ${r.failed} con error` : ""}`;
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  return ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? fallback;
}

export default function NotificacionesPage() {
  const [settings, setSettings] = useState<DailySummarySettings | null>(null);
  const [last, setLast] = useState<LastSend | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetch("/api/config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("config"))))
      .then((config: Record<string, unknown>) => {
        setSettings(parseSettings(config[DAILY_SUMMARY_KEY]));
        setLast(parseLastSend(config[DAILY_SUMMARY_LAST_KEY]));
      })
      .catch(() => setError("No se pudo cargar la configuración."));
  }, []);

  const patch = (change: Partial<DailySummarySettings>) =>
    setSettings((prev) => (prev ? { ...prev, ...change } : prev));

  const updateRecipient = (id: string, change: Partial<Recipient>) =>
    setSettings((prev) =>
      prev ? { ...prev, destinatarios: prev.destinatarios.map((r) => (r.id === id ? { ...r, ...change } : r)) } : prev,
    );

  const save = async (): Promise<boolean> => {
    if (!settings) return false;
    setError(null);
    setNotice(null);
    const cleaned = {
      ...settings,
      destinatarios: settings.destinatarios.map((r) => ({ ...r, telefono: r.telefono.replace(/\D/g, "") })),
    };
    const parsed = dailySummarySettingsSchema.safeParse(cleaned);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join("; "));
      return false;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [DAILY_SUMMARY_KEY]: parsed.data }),
      });
      if (!res.ok) throw new Error(await errorOf(res, "No se pudo guardar."));
      setSettings(parsed.data);
      setNotice("Guardado.");
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    if (!(await save())) return;
    setTesting(true);
    try {
      const res = await fetch("/api/admin/daily-summary", { method: "POST" });
      if (!res.ok) throw new Error(await errorOf(res, "No se pudo enviar la prueba."));
      const result = (await res.json()) as TestResult;
      setNotice(`Prueba enviada con los datos de hoy. ${describe("Mail", result.email)} · ${describe("WhatsApp", result.whatsapp)}.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo enviar la prueba.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="page-fade flex flex-col gap-4 p-2">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-headline text-2xl font-black text-gray-800">Notificaciones diarias</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Al cerrar el día se envía un resumen (pedidos, ventas, ticket promedio, más vendidos) por mail y por
            WhatsApp a las personas habilitadas. Se manda una sola vez por día, pasada la hora de cierre.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={sendTest}
            disabled={saving || testing || !settings}
            className="neumorphic rounded-full px-4 py-2.5 text-sm font-bold text-gray-700 inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Send size={16} aria-hidden /> {testing ? "Enviando..." : "Enviar prueba ahora"}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !settings}
            className="btn-glow text-white rounded-full px-5 py-2.5 text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Save size={16} aria-hidden /> {saving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </header>

      {error && <p role="alert" className="text-xs font-bold text-red-600 px-3 py-2 rounded-lg bg-red-50 border border-red-100">{error}</p>}
      {notice && <p role="status" className="text-xs font-bold text-green-700 px-3 py-2 rounded-lg bg-green-50 border border-green-100">{notice}</p>}
      {!settings && !error && <div className="h-40 rounded-2xl shimmer" aria-hidden />}

      {settings && (
        <>
          <section className="neumorphic rounded-2xl p-5 grid gap-4 md:grid-cols-2 items-center">
            <div className="neumorphic-inset rounded-xl px-4 py-3.5">
              <Switch checked={settings.activo} onChange={(activo) => patch({ activo })} label="Enviar el resumen al cerrar el día" />
            </div>
            <label className="flex flex-col gap-1.5 text-xs font-bold text-gray-600">
              Hora de cierre (Buenos Aires)
              <input
                type="time"
                value={settings.hora}
                onChange={(e) => patch({ hora: e.target.value })}
                className={inputClass}
              />
            </label>
            <p className="md:col-span-2 text-xs text-gray-500">
              {last
                ? `Último envío: ${last.fecha.split("-").reverse().join("/")} · ${last.email} mail(s), ${last.whatsapp} WhatsApp${last.errores ? `, ${last.errores} con error` : ""}.`
                : "Todavía no se envió ningún resumen."}
            </p>
          </section>

          <section className="flex flex-col gap-3" aria-label="Destinatarios">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-sm text-gray-800">Personas habilitadas</h2>
              <button
                type="button"
                onClick={() => patch({ destinatarios: [...settings.destinatarios, newRecipient()] })}
                disabled={settings.destinatarios.length >= MAX_RECIPIENTS}
                className="neumorphic rounded-full px-4 py-2 text-xs font-bold text-gray-700 inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Plus size={14} aria-hidden /> Agregar persona
              </button>
            </div>

            {settings.destinatarios.length === 0 && (
              <p className="neumorphic-inset rounded-2xl p-6 text-sm text-gray-500 text-center">
                Nadie habilitado todavía. Agregá a quienes tienen que recibir el resumen.
              </p>
            )}

            <ul className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {settings.destinatarios.map((r, index) => (
                <li key={r.id} className="neumorphic rounded-2xl p-5 flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="neumorphic-inset rounded-xl px-3 py-2">
                      <Switch checked={r.activo} onChange={(activo) => updateRecipient(r.id, { activo })} label="Recibe el resumen" />
                    </div>
                    <button
                      type="button"
                      aria-label={`Quitar a ${r.nombre || `la persona ${index + 1}`}`}
                      onClick={() => patch({ destinatarios: settings.destinatarios.filter((x) => x.id !== r.id) })}
                      className="p-2 rounded-full text-red-500 hover:text-red-600"
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  </div>
                  <label className="flex flex-col gap-1.5 text-xs font-bold text-gray-600">
                    Nombre
                    <input className={inputClass} value={r.nombre} onChange={(e) => updateRecipient(r.id, { nombre: e.target.value })} placeholder="Ej. Ana Pérez" />
                  </label>
                  <label className="flex flex-col gap-1.5 text-xs font-bold text-gray-600">
                    <span className="inline-flex items-center gap-1.5"><Mail size={13} aria-hidden /> Mail</span>
                    <input type="email" className={inputClass} value={r.email} onChange={(e) => updateRecipient(r.id, { email: e.target.value })} placeholder="ana@tulocal.com" />
                  </label>
                  <label className="flex flex-col gap-1.5 text-xs font-bold text-gray-600">
                    <span className="inline-flex items-center gap-1.5"><MessageCircle size={13} aria-hidden /> WhatsApp (con código de país)</span>
                    <input inputMode="numeric" className={inputClass} value={r.telefono} onChange={(e) => updateRecipient(r.id, { telefono: e.target.value })} placeholder="5491155550101" />
                  </label>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
