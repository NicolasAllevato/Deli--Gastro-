"use client";

import { EditableArea } from "../_components/AdminAccess";
import { useCallback, useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { TOPIC_WA_CAMPAIGNS } from "@/lib/live-refresh";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import { formatDateTimeAR } from "@/lib/time-ar";

type Kind = "all" | "inactive" | "frequent" | "tier";

interface Preview {
  count: number;
  sample: string[];
  maxRecipients: number;
  campaignsLeftToday: number;
}

interface Campaign {
  id: string;
  name: string;
  message: string;
  status: "sending" | "done" | "failed";
  recipients: number;
  sent: number;
  failed: number;
  created_at: string;
}

const KINDS: ReadonlyArray<{ value: Kind; label: string }> = [
  { value: "all", label: "Todos los que aceptaron promociones" },
  { value: "inactive", label: "Clientes que no piden hace tiempo" },
  { value: "frequent", label: "Clientes frecuentes" },
  { value: "tier", label: "Por nivel de fidelidad" },
];

const TIERS = ["Bronce", "Plata", "Oro", "Platino"] as const;

const STATUS = {
  sending: { label: "Enviando", tone: "yellow" },
  done: { label: "Enviada", tone: "green" },
  failed: { label: "Falló", tone: "red" },
} as const;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "No se pudo completar la operación.");
  return json;
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function CampanasPageContent() {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [days, setDays] = useState("30");
  const [minOrders, setMinOrders] = useState("3");
  const [tier, setTier] = useState<(typeof TIERS)[number]>("Oro");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [history, setHistory] = useState<Campaign[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const segment = () => {
    switch (kind) {
      case "inactive": return { kind, days: Number(days) };
      case "frequent": return { kind, minOrders: Number(minOrders) };
      case "tier": return { kind, tier };
      default: return { kind };
    }
  };

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await request<Campaign[]>("/api/whatsapp/campaigns"));
    } catch {
      /* el historial es secundario: si falla, la pantalla sigue usable */
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadHistory();
  }, [loadHistory]);

  // Avance de envío en vivo (migración 011); en demo se consulta cada 5 s como antes.
  useLiveRefresh({ topic: TOPIC_WA_CAMPAIGNS, refresh: loadHistory, demoPollMs: 5000 });

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo completar la operación.");
    } finally {
      setBusy(false);
    }
  };

  const calculate = () =>
    void run(async () => {
      setPreview(await request<Preview>("/api/whatsapp/campaigns/preview", post({ segment: segment() })));
    });

  const launch = () => {
    if (!preview || !confirm(`¿Enviar la campaña a ${preview.count} clientes?`)) return;
    void run(async () => {
      await request("/api/whatsapp/campaigns", post({ name, message, segment: segment() }));
      setNotice("Campaña en marcha. Los envíos se van registrando abajo.");
      setPreview(null);
      setName("");
      setMessage("");
      await loadHistory();
    });
  };

  const canLaunch = Boolean(preview && preview.count > 0 && preview.campaignsLeftToday > 0 && name.trim() && message.trim());

  return (
    <div className="space-y-5 max-w-3xl mx-auto pb-10">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full neumorphic flex items-center justify-center text-brand-orange">
          <Megaphone size={20} aria-hidden />
        </div>
        <div>
          <h1 className="font-headline font-black text-xl text-gray-800 tracking-tight">Campañas de promoción</h1>
          <p className="text-gray-500 text-xs mt-0.5 font-medium">Mensajes por WhatsApp para recuperar y fidelizar clientes.</p>
        </div>
      </div>

      {error && <p role="alert" className="text-xs font-bold text-red-600 px-3 py-2 rounded-lg bg-red-50 border border-red-100">{error}</p>}
      {notice && <p role="status" className="text-xs font-bold text-green-700 px-3 py-2 rounded-lg bg-green-50 border border-green-100">{notice}</p>}

      <section className="neumorphic rounded-2xl p-5 space-y-4" aria-label="Nueva campaña">
        <Field label="Nombre (solo para vos)" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <Field
          as="textarea"
          rows={3}
          label="Mensaje de la promoción"
          value={message}
          maxLength={300}
          onChange={(e) => setMessage(e.target.value)}
          hint="Se manda como “¡Hola {nombre}! {tu mensaje} Pedí por WhatsApp o desde nuestra web.” Sin saltos de línea."
        />

        <div>
          <label htmlFor="segment" className="block text-xs font-bold text-gray-600 ml-4 mb-2 uppercase tracking-widest">A quién</label>
          <select
            id="segment"
            value={kind}
            onChange={(e) => { setKind(e.target.value as Kind); setPreview(null); }}
            className="w-full px-6 py-4 rounded-2xl neumorphic-inset text-gray-800 outline-none focus:ring-2 focus:ring-brand-orange/50 font-bold bg-transparent"
          >
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>

        {kind === "inactive" && <Field label="Sin pedir hace más de (días)" type="number" min={1} max={365} value={days} onChange={(e) => { setDays(e.target.value); setPreview(null); }} />}
        {kind === "frequent" && <Field label="Pidieron al menos (veces en 60 días)" type="number" min={1} max={50} value={minOrders} onChange={(e) => { setMinOrders(e.target.value); setPreview(null); }} />}
        {kind === "tier" && (
          <div>
            <label htmlFor="tier" className="block text-xs font-bold text-gray-600 ml-4 mb-2 uppercase tracking-widest">Nivel</label>
            <select
              id="tier"
              value={tier}
              onChange={(e) => { setTier(e.target.value as (typeof TIERS)[number]); setPreview(null); }}
              className="w-full px-6 py-4 rounded-2xl neumorphic-inset text-gray-800 outline-none focus:ring-2 focus:ring-brand-orange/50 font-bold bg-transparent"
            >
              {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="secondary" onClick={calculate} loading={busy}>Ver a cuántos llega</Button>
          <Button size="sm" onClick={launch} disabled={!canLaunch || busy}>Enviar campaña</Button>
        </div>

        {preview && (
          <div role="status" className="neumorphic-inset rounded-xl p-4 text-sm text-gray-700 space-y-1">
            <p className="font-bold">
              {preview.count === 0 ? "Nadie cumple este segmento." : `Llega a ${preview.count} clientes`}
              {preview.sample.length > 0 && <span className="font-medium text-gray-500"> · {preview.sample.join(", ")}{preview.count > preview.sample.length ? "…" : ""}</span>}
            </p>
            <p className="text-xs text-gray-500">
              Solo reciben quienes aceptaron promociones. Máximo {preview.maxRecipients} por campaña; te quedan {preview.campaignsLeftToday} hoy.
              Meta cobra cada mensaje de marketing a tu cuenta según la tarifa de tu país.
            </p>
            {preview.count > preview.maxRecipients && <p className="text-xs font-bold text-red-600">Son demasiados: afiná el segmento.</p>}
          </div>
        )}
      </section>

      <section aria-label="Historial" className="space-y-2">
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest px-1">Historial</p>
        {history.length === 0 ? (
          <div className="neumorphic-inset rounded-xl p-6 text-center text-sm text-gray-500">Todavía no enviaste campañas.</div>
        ) : (
          history.map((c) => (
            <div key={c.id} className="neumorphic rounded-xl p-3.5 space-y-1">
              <div className="flex items-center gap-2">
                <p className="font-bold text-sm text-gray-800 truncate flex-1">{c.name}</p>
                <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
              </div>
              <p className="text-xs text-gray-500 truncate">{c.message}</p>
              <p className="text-[11px] text-gray-500">
                {formatDateTimeAR(c.created_at, { dateStyle: "short", timeStyle: "short" })}
                {" · "}{c.sent} de {c.recipients} enviados{c.failed > 0 ? ` · ${c.failed} fallidos` : ""}
              </p>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

/** Con acceso de solo lectura la pantalla se ve completa, pero sus campos y botones quedan deshabilitados. */
export default function CampanasPage() {
  return (
    <EditableArea section="comunicacion">
      <CampanasPageContent />
    </EditableArea>
  );
}
