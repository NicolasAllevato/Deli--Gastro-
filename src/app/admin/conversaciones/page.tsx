"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Hand, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TOPIC_WA_CONVERSATIONS, waConversationTopic } from "@/lib/live-refresh";
import { useLiveRefresh } from "@/lib/useLiveRefresh";

interface ConversationItem {
  id: string;
  phone: string;
  name: string;
  humanTakeover: boolean;
  lastInboundAt: string | null;
  last: { direction: string; text: string; at: string } | null;
}

interface ThreadMessage {
  id: string;
  direction: "in" | "out";
  type: string;
  body: string | null;
  status: string | null;
  tokens: number | null;
  created_at: string;
}

interface Thread {
  conversation: { id: string; phone: string; humanTakeover: boolean };
  messages: ThreadMessage[];
}

/** Consulta periódica solo en modo demo; en producción llegan avisos en tiempo real (migración 011). */
const DEMO_POLL_MS = 5000;

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

const time = (iso: string) => new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });

export default function ConversacionesPage() {
  const [list, setList] = useState<ConversationItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    try {
      setList(await request<ConversationItem[]>("/api/whatsapp/conversations"));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las conversaciones.");
    } finally {
      setLoaded(true);
    }
  }, []);

  // Última conversación pedida: una respuesta vieja que llega tarde no pisa a la actual.
  const wantedRef = useRef<string | null>(null);
  const refreshThread = useCallback(async (id: string) => {
    wantedRef.current = id;
    try {
      const next = await request<Thread>(`/api/whatsapp/conversations/${id}`);
      if (wantedRef.current === id) setThread(next);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la conversación.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshList();
  }, [refreshList]);

  useLiveRefresh({ topic: TOPIC_WA_CONVERSATIONS, refresh: refreshList, demoPollMs: DEMO_POLL_MS });

  useEffect(() => {
    if (!selected) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshThread(selected);
  }, [selected, refreshThread]);

  const refreshSelected = useCallback(() => (selected ? refreshThread(selected) : undefined), [selected, refreshThread]);
  useLiveRefresh({
    topic: waConversationTopic(selected ?? "none"),
    refresh: refreshSelected,
    demoPollMs: DEMO_POLL_MS,
    enabled: selected !== null,
  });

  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo completar la operación.");
    } finally {
      setBusy(false);
    }
  };

  const toggleTakeover = () => {
    if (!thread) return;
    void act(async () => {
      await request(`/api/whatsapp/conversations/${thread.conversation.id}`, send("PATCH", { humanTakeover: !thread.conversation.humanTakeover }));
      await Promise.all([refreshThread(thread.conversation.id), refreshList()]);
    });
  };

  const reply = () => {
    if (!thread || !text.trim()) return;
    void act(async () => {
      await request(`/api/whatsapp/conversations/${thread.conversation.id}`, send("POST", { text }));
      setText("");
      await refreshThread(thread.conversation.id);
    });
  };

  const open = selected !== null;

  return (
    <div className="space-y-5 max-w-5xl mx-auto pb-10">
      <div>
        <h1 className="font-headline font-black text-xl text-gray-800 tracking-tight">Conversaciones</h1>
        <p className="text-gray-500 text-xs mt-0.5 font-medium">Lo que hablan tus clientes con el agente por WhatsApp.</p>
      </div>

      {error && <p role="alert" className="text-xs font-bold text-red-600 px-3 py-2 rounded-lg bg-red-50 border border-red-100">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4">
        <section aria-label="Lista de conversaciones" className={`space-y-2 ${open ? "hidden md:block" : ""}`}>
          {loaded && list.length === 0 && (
            <div className="neumorphic-inset rounded-xl p-6 text-center text-sm text-gray-500">Todavía no hay conversaciones.</div>
          )}
          {list.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelected(c.id)}
              aria-current={selected === c.id}
              className={`w-full text-left rounded-xl p-3 ${selected === c.id ? "neumorphic-inset" : "neumorphic neumorphic-hover"}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-bold text-sm text-gray-800 truncate">{c.name}</span>
                {c.humanTakeover && <Hand size={14} className="text-brand-orange shrink-0" aria-label="Atiende una persona" />}
              </span>
              <span className="block text-xs text-gray-500 truncate mt-0.5">
                {c.last ? `${c.last.direction === "out" ? "Vos: " : ""}${c.last.text}` : "Sin mensajes"}
              </span>
            </button>
          ))}
        </section>

        <section aria-label="Conversación" className={`neumorphic rounded-2xl p-4 flex flex-col gap-3 min-h-[420px] ${open ? "" : "hidden md:flex"}`}>
          {!thread || selected !== thread.conversation.id ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-2 text-sm">
              <MessageSquare size={26} aria-hidden /> Elegí una conversación
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setSelected(null)} aria-label="Volver a la lista" className="md:hidden p-2 rounded-full neumorphic">
                  <ArrowLeft size={14} aria-hidden />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-gray-800 truncate">+{thread.conversation.phone}</p>
                  <p className="text-[11px] text-gray-500">
                    {thread.conversation.humanTakeover ? "Atiende una persona (el agente no responde)" : "Responde el agente"}
                  </p>
                </div>
                <Button size="sm" variant="secondary" onClick={toggleTakeover} loading={busy} leftIcon={<Hand size={14} aria-hidden />}>
                  {thread.conversation.humanTakeover ? "Devolver al agente" : "Tomar el control"}
                </Button>
              </div>

              <div className="flex-1 neumorphic-inset rounded-xl p-3 space-y-2 overflow-y-auto max-h-[420px]" role="log" aria-live="polite">
                {thread.messages.map((m) => (
                  <div key={m.id} className={`max-w-[85%] ${m.direction === "out" ? "ml-auto" : ""}`}>
                    <p className={`text-sm px-3 py-2 rounded-xl whitespace-pre-wrap ${m.direction === "out" ? "bg-brand-orange text-white" : "neumorphic text-gray-700"}`}>
                      {m.body ?? (m.type === "audio" ? "🎤 Audio sin transcribir" : "Mensaje no soportado")}
                    </p>
                    <p className={`text-[10px] text-gray-500 mt-0.5 ${m.direction === "out" ? "text-right" : ""}`}>
                      {time(m.created_at)}{m.type === "audio" ? " · audio" : ""}{m.status ? ` · ${m.status}` : ""}
                    </p>
                  </div>
                ))}
              </div>

              <form onSubmit={(e) => { e.preventDefault(); reply(); }} className="flex gap-2">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={1000}
                  aria-label="Respuesta manual"
                  placeholder="Escribir como el local"
                  className="flex-1 min-w-0 px-4 py-3 rounded-xl neumorphic-inset text-sm text-gray-700 placeholder-gray-500 outline-none focus:ring-2 focus:ring-brand-orange/40"
                />
                <Button type="submit" size="sm" aria-label="Enviar respuesta" disabled={busy || !text.trim()} leftIcon={<Send size={14} aria-hidden />}>
                  Enviar
                </Button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
