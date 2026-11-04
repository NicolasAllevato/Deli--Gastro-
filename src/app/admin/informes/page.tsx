"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart3, Download, Send, Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatMoney } from "@/lib/orders";
import type {
  DeliveryTimes, NewVsReturning, RecurringCustomer, ReviewsSummary, SalesGroup, SalesSummary, TopProduct,
} from "@/lib/reports/analytics";
import { RANGE_KEYS, RANGE_LABELS, type RangeKey } from "@/lib/reports/range";

interface Snapshot {
  range: RangeKey;
  label: string;
  sales: SalesSummary;
  channels: SalesGroup[];
  topProducts: TopProduct[];
  recurring: RecurringCustomer[];
  customers: NewVsReturning;
  times: DeliveryTimes;
  reviews: ReviewsSummary;
}

interface Turn {
  role: "user" | "assistant";
  content: string;
}

const CHANNEL_LABEL: Record<string, string> = { web: "Web", whatsapp: "WhatsApp", mostrador: "Mostrador", fudo: "Fudo" };
const SUGGESTIONS = ["¿Cuánto vendí esta semana?", "¿Cuáles son los productos más vendidos?", "¿Qué clientes piden seguido?"];

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "No se pudo completar la operación.");
  return json;
}

const minutes = (n: number | null) => (n === null ? "—" : `${n} min`);

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="neumorphic rounded-2xl p-4">
      <p className="text-gray-500 text-[11px] font-bold uppercase tracking-widest mb-1">{label}</p>
      <p className="text-xl font-headline font-black text-gray-800">{value}</p>
      {hint && <p className="text-[11px] text-gray-500 mt-0.5">{hint}</p>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="neumorphic rounded-2xl p-5 space-y-3">
      <h2 className="font-headline font-bold text-sm uppercase tracking-widest text-gray-700">{title}</h2>
      {children}
    </section>
  );
}

const Empty = ({ text }: { text: string }) => <p className="text-xs text-gray-500">{text}</p>;

export default function InformesPage() {
  const [range, setRange] = useState<RangeKey>("last_7_days");
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const load = useCallback(async (key: RangeKey) => {
    setError(null);
    try {
      setSnap(await request<Snapshot>(`/api/admin/reports?range=${key}`));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el informe.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(range);
  }, [range, load]);

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || thinking) return;
    const history: Turn[] = [...turns, { role: "user", content: text }];
    setTurns(history);
    setDraft("");
    setThinking(true);
    setChatError(null);
    try {
      const { reply } = await request<{ reply: string }>("/api/admin/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history }),
      });
      setTurns([...history, { role: "assistant", content: reply }]);
    } catch (e: unknown) {
      setChatError(e instanceof Error ? e.message : "El analista no pudo responder.");
    } finally {
      setThinking(false);
    }
  };

  const maxDay = Math.max(1, ...(snap?.sales.groups.map((g) => g.revenue) ?? [0]));

  return (
    <div className="space-y-5 max-w-4xl mx-auto pb-10">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-10 h-10 rounded-full neumorphic flex items-center justify-center text-brand-orange">
          <BarChart3 size={20} aria-hidden />
        </div>
        <div className="mr-auto">
          <h1 className="font-headline font-black text-xl text-gray-800 tracking-tight">Informes</h1>
          <p className="text-gray-500 text-xs mt-0.5 font-medium">Ventas, pedidos y clientes del período.</p>
        </div>
        <label className="sr-only" htmlFor="range">Período</label>
        <select
          id="range"
          value={range}
          onChange={(e) => setRange(e.target.value as RangeKey)}
          className="px-4 py-2.5 rounded-xl neumorphic-inset text-sm text-gray-700 font-bold bg-transparent outline-none focus:ring-2 focus:ring-brand-orange/40"
        >
          {RANGE_KEYS.map((key) => <option key={key} value={key}>{RANGE_LABELS[key]}</option>)}
        </select>
        <a
          href={`/api/admin/reports/export?range=${range}`}
          download
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl neumorphic text-sm font-bold text-brand-orange"
        >
          <Download size={14} aria-hidden /> CSV
        </a>
        <a
          href={`/api/admin/clients/export?range=${range}`}
          download
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl neumorphic text-sm font-bold text-brand-orange"
        >
          <Users size={14} aria-hidden /> Exportar clientes
        </a>
      </div>

      {error && <p role="alert" className="text-xs font-bold text-red-600 px-3 py-2 rounded-lg bg-red-50 border border-red-100">{error}</p>}

      {snap && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Kpi label="Ventas" value={formatMoney(snap.sales.revenue)} hint={`${snap.sales.orders} pedidos`} />
            <Kpi label="Ticket promedio" value={formatMoney(snap.sales.avgTicket)} />
            <Kpi label="Envíos cobrados" value={formatMoney(snap.sales.deliveryFees)} />
            <Kpi label="Cancelados" value={String(snap.sales.cancelled)} hint={`${Math.round(snap.sales.cancellationRate * 100)}% del total`} />
          </div>

          <Card title="Ventas por día">
            {snap.sales.groups.length === 0 ? <Empty text="No hubo ventas en este período." /> : (
              <ul className="space-y-1.5">
                {snap.sales.groups.map((g) => (
                  <li key={g.key} className="flex items-center gap-3 text-xs text-gray-600">
                    <span className="w-20 shrink-0 font-bold">{g.key.slice(5).split("-").reverse().join("/")}</span>
                    <span className="flex-1 h-3 rounded-full neumorphic-inset overflow-hidden" aria-hidden>
                      <span className="block h-full bg-brand-orange rounded-full" style={{ width: `${Math.max(3, (g.revenue / maxDay) * 100)}%` }} />
                    </span>
                    <span className="w-28 text-right shrink-0">{formatMoney(g.revenue)} · {g.orders}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card title="Productos más vendidos">
              {snap.topProducts.length === 0 ? <Empty text="Sin datos." /> : (
                <ol className="space-y-1.5 text-sm text-gray-700">
                  {snap.topProducts.map((p) => (
                    <li key={p.name} className="flex justify-between gap-2"><span className="truncate">{p.name}</span><span className="font-bold shrink-0">{p.units} u.</span></li>
                  ))}
                </ol>
              )}
            </Card>

            <Card title="Clientes recurrentes">
              {snap.recurring.length === 0 ? <Empty text="Nadie repitió pedido en este período." /> : (
                <ul className="space-y-1.5 text-sm text-gray-700">
                  {snap.recurring.map((c) => (
                    <li key={c.name} className="flex justify-between gap-2"><span className="truncate">{c.name}</span><span className="font-bold shrink-0">{c.orders} pedidos · {formatMoney(c.spent)}</span></li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Clientes nuevos y de siempre">
              <p className="text-sm text-gray-700">
                <strong>{snap.customers.newCustomers}</strong> nuevos ({snap.customers.ordersFromNew} pedidos) ·{" "}
                <strong>{snap.customers.returningCustomers}</strong> que ya habían pedido ({snap.customers.ordersFromReturning} pedidos)
              </p>
            </Card>

            <Card title="Por canal">
              {snap.channels.length === 0 ? <Empty text="Sin datos." /> : (
                <ul className="space-y-1.5 text-sm text-gray-700">
                  {snap.channels.map((c) => (
                    <li key={c.key} className="flex justify-between"><span>{CHANNEL_LABEL[c.key] ?? c.key}</span><span className="font-bold">{formatMoney(c.revenue)} · {c.orders}</span></li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title={`Tiempos de entrega (${snap.times.delivered} entregas)`}>
              <dl className="grid grid-cols-2 gap-2 text-sm text-gray-700">
                <dt>Cocina</dt><dd className="font-bold text-right">{minutes(snap.times.avgKitchen)}</dd>
                <dt>Espera de despacho</dt><dd className="font-bold text-right">{minutes(snap.times.avgDispatchWait)}</dd>
                <dt>En ruta</dt><dd className="font-bold text-right">{minutes(snap.times.avgRoute)}</dd>
                <dt>Total</dt><dd className="font-bold text-right">{minutes(snap.times.avgTotal)}</dd>
              </dl>
            </Card>

            <Card title="Reseñas">
              {snap.reviews.count === 0 ? <Empty text="No hubo reseñas en este período." /> : (
                <p className="text-sm text-gray-700">
                  <strong>{snap.reviews.average}</strong> de 5 en {snap.reviews.count} reseñas · {snap.reviews.lowRated} de 3 estrellas o menos
                </p>
              )}
            </Card>
          </div>
        </>
      )}

      <Card title="Preguntale al analista">
        <div className="neumorphic-inset rounded-xl p-3 space-y-2 min-h-[120px] max-h-[360px] overflow-y-auto" role="log" aria-live="polite">
          {turns.length === 0 && (
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => void ask(s)} className="text-xs px-3 py-1.5 rounded-full neumorphic text-gray-600">{s}</button>
              ))}
            </div>
          )}
          {turns.map((turn, i) => (
            <p
              key={`${i}-${turn.role}`}
              className={`text-sm px-3 py-2 rounded-xl max-w-[85%] whitespace-pre-wrap ${turn.role === "user" ? "ml-auto bg-brand-orange text-white" : "neumorphic text-gray-700"}`}
            >
              {turn.content}
            </p>
          ))}
          {thinking && <p className="text-xs text-gray-500 animate-pulse">Analizando...</p>}
        </div>
        {chatError && <p role="alert" className="text-xs font-bold text-red-600">{chatError}</p>}
        <form onSubmit={(e) => { e.preventDefault(); void ask(draft); }} className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={2000}
            aria-label="Pregunta para el analista"
            placeholder="Ej. ¿cuánto vendí ayer?"
            className="flex-1 min-w-0 px-4 py-3 rounded-xl neumorphic-inset text-sm text-gray-700 placeholder-gray-500 outline-none focus:ring-2 focus:ring-brand-orange/40"
          />
          <Button type="submit" size="sm" aria-label="Enviar pregunta" disabled={thinking || !draft.trim()} leftIcon={<Send size={14} aria-hidden />}>Preguntar</Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setTurns([])} disabled={turns.length === 0}>Limpiar</Button>
        </form>
        <p className="text-[11px] text-gray-500">
          El analista consulta tus datos con herramientas de solo lectura. Para responder, envía a OpenAI cifras agregadas y los nombres de tus clientes recurrentes.
        </p>
      </Card>
    </div>
  );
}
