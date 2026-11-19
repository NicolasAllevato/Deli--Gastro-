"use client";

import { EditableArea } from "../_components/AdminAccess";
import { useCallback, useEffect, useState } from "react";
import { Bot, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Switch } from "@/components/ui/Switch";
import type { AgentSettings } from "@/lib/agent/settings";

type Mode = "openai" | "demo" | "none";

interface State {
  settings: AgentSettings;
  keyHint: string;
  mode: Mode;
}

interface Turn {
  role: "user" | "assistant";
  content: string;
}

const MODE_LABEL: Record<Mode, string> = {
  openai: "Conectado a OpenAI (GPT-4o mini)",
  demo: "Modo demo: respuestas de ejemplo, sin IA real",
  none: "Sin clave de OpenAI: el agente no puede responder",
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "No se pudo completar la operación.");
  return json;
}

const send = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function AgentePageContent() {
  const [state, setState] = useState<State | null>(null);
  const [form, setForm] = useState<AgentSettings | null>(null);
  const [openaiKey, setOpenaiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);

  const apply = useCallback((next: State) => {
    setState(next);
    setForm(next.settings);
  }, []);

  useEffect(() => {
    request<State>("/api/agent/config").then(apply).catch((e: unknown) =>
      setError(e instanceof Error ? e.message : "No se pudo cargar la configuración."),
    );
  }, [apply]);

  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo completar la operación.");
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = () => {
    if (!form) return;
    void run(async () => {
      await request("/api/config", send("PATCH", {
        agente_activo: form.active,
        agente_audios: form.transcribeAudio,
        agente_nombre: form.name,
        agente_tono: form.tone,
        agente_instrucciones: form.instructions,
        negocio_nombre: form.businessName,
        horario_apertura: form.hours.open,
        horario_cierre: form.hours.close,
      }));
      apply(await request<State>("/api/agent/config"));
    }, "Configuración guardada.");
  };

  const saveKey = () =>
    void run(async () => {
      apply(await request<State>("/api/agent/config", send("PUT", { openaiKey })));
      setOpenaiKey("");
    }, "Clave guardada.");

  const ask = async () => {
    const text = draft.trim();
    if (!text || thinking) return;
    const history: Turn[] = [...turns, { role: "user", content: text }];
    setTurns(history);
    setDraft("");
    setThinking(true);
    setError(null);
    try {
      const { reply } = await request<{ reply: string }>("/api/agent/test", send("POST", { history }));
      setTurns([...history, { role: "assistant", content: reply }]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "El agente no pudo responder.");
    } finally {
      setThinking(false);
    }
  };

  if (!form || !state) {
    return <p className="text-sm text-gray-500 p-6">{error ?? "Cargando..."}</p>;
  }

  return (
    <div className="space-y-5 max-w-3xl mx-auto pb-10">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full neumorphic flex items-center justify-center text-brand-orange">
          <Bot size={20} aria-hidden />
        </div>
        <div>
          <h1 className="font-headline font-black text-xl text-gray-800 tracking-tight">Agente de pedidos</h1>
          <p className="text-gray-500 text-xs mt-0.5 font-medium">{MODE_LABEL[state.mode]}</p>
        </div>
      </div>

      {error && <p role="alert" className="text-xs font-bold text-red-600 px-3 py-2 rounded-lg bg-red-50 border border-red-100">{error}</p>}
      {notice && <p role="status" className="text-xs font-bold text-green-700 px-3 py-2 rounded-lg bg-green-50 border border-green-100">{notice}</p>}

      <section className="neumorphic rounded-2xl p-5 space-y-4" aria-label="Configuración del agente">
        <Switch
          checked={form.active}
          onChange={(active) => setForm({ ...form, active })}
          label="Agente activo"
          hint="Cuando está activo, responde solo los mensajes de WhatsApp (salvo las conversaciones que vos tomes)."
        />
        <Switch
          checked={form.transcribeAudio}
          onChange={(transcribeAudio) => setForm({ ...form, transcribeAudio })}
          label="Recibir y transcribir audios"
          hint="Los clientes pueden mandar audios con consultas o pedidos: el agente los pasa a texto y responde. Si lo apagás, les pide que escriban."
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Nombre del negocio" value={form.businessName} maxLength={80} onChange={(e) => setForm({ ...form, businessName: e.target.value })} />
          <Field label="Nombre del agente" value={form.name} maxLength={40} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Field label="Abre" type="time" value={form.hours.open} onChange={(e) => setForm({ ...form, hours: { ...form.hours, open: e.target.value } })} />
          <Field label="Cierra" type="time" value={form.hours.close} onChange={(e) => setForm({ ...form, hours: { ...form.hours, close: e.target.value } })} />
        </div>
        <Field label="Tono" value={form.tone} maxLength={200} onChange={(e) => setForm({ ...form, tone: e.target.value })} hint="Ej. cálido, cercano y breve" />
        <Field
          as="textarea"
          rows={4}
          label="Indicaciones para el agente"
          value={form.instructions}
          maxLength={1000}
          onChange={(e) => setForm({ ...form, instructions: e.target.value })}
          hint="Promos, aclaraciones del local, cosas que tiene que ofrecer. Los precios y el menú los toma solo de Productos."
        />
        <Button size="sm" onClick={saveSettings} loading={busy}>Guardar</Button>
      </section>

      <section className="neumorphic rounded-2xl p-5 space-y-3" aria-label="Clave de OpenAI">
        <h2 className="font-headline font-bold text-sm uppercase tracking-widest text-gray-700">Clave de OpenAI</h2>
        <p className="text-xs text-gray-500">El consumo de la IA (texto y transcripción de audios) lo cobra OpenAI a tu cuenta.</p>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Field
              label="API key"
              type="password"
              autoComplete="off"
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              placeholder={state.keyHint || "sk-..."}
              hint={state.keyHint ? "Guardada. Pegá otra para reemplazarla." : undefined}
            />
          </div>
          <Button size="sm" variant="secondary" onClick={saveKey} loading={busy} disabled={openaiKey.trim().length < 10}>Guardar</Button>
        </div>
      </section>

      <section className="neumorphic rounded-2xl p-5 space-y-3" aria-label="Probar el agente">
        <h2 className="font-headline font-bold text-sm uppercase tracking-widest text-gray-700">Probar el agente</h2>
        <p className="text-xs text-gray-500">
          Hace consultas reales (menú, horarios, cotización) pero no crea pedidos ni manda mensajes por WhatsApp.
        </p>
        <div className="neumorphic-inset rounded-xl p-3 space-y-2 min-h-[140px] max-h-[320px] overflow-y-auto" role="log" aria-live="polite">
          {turns.length === 0 && <p className="text-xs text-gray-500">Escribí como lo haría un cliente. Ej: “¿qué tienen para comer?”</p>}
          {turns.map((turn, i) => (
            <p
              key={`${i}-${turn.role}`}
              className={`text-sm px-3 py-2 rounded-xl max-w-[85%] whitespace-pre-wrap ${
                turn.role === "user" ? "ml-auto bg-brand-orange text-white" : "neumorphic text-gray-700"
              }`}
            >
              {turn.content}
            </p>
          ))}
          {thinking && <p className="text-xs text-gray-500 animate-pulse">Escribiendo...</p>}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void ask(); }} className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={2000}
            aria-label="Mensaje de prueba"
            placeholder="Mensaje del cliente"
            className="flex-1 min-w-0 px-4 py-3 rounded-xl neumorphic-inset text-sm text-gray-700 placeholder-gray-500 outline-none focus:ring-2 focus:ring-brand-orange/40"
          />
          <Button type="submit" size="sm" aria-label="Enviar mensaje de prueba" disabled={thinking || !draft.trim()} leftIcon={<Send size={14} aria-hidden />}>
            Enviar
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setTurns([])} disabled={turns.length === 0}>Limpiar</Button>
        </form>
      </section>
    </div>
  );
}

/** Con acceso de solo lectura la pantalla se ve completa, pero sus campos y botones quedan deshabilitados. */
export default function AgentePage() {
  return (
    <EditableArea section="comunicacion">
      <AgentePageContent />
    </EditableArea>
  );
}
