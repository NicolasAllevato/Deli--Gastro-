"use client";

import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { formatMoney } from "@/lib/orders";
import { formatDateTimeAR } from "@/lib/time-ar";
import type { CreditClient, CreditConfig, CreditHistory } from "@/lib/data";

const MOTIVO_LABEL: Record<string, string> = {
  reclamo: "Reclamo resuelto",
  compra: "Usado en un pedido",
  devolucion: "Devolución",
  ajuste: "Ajuste manual",
  vencido: "Vencido",
};

const money = (cents: number) => formatMoney(cents / 100);
const fmt = (iso: string) => formatDateTimeAR(iso, { dateStyle: "short", timeStyle: "short" });

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !json) throw new Error(json?.error ?? "No se pudo completar la operación.");
  return json;
}

function ConfigCard({ config, onSaved }: { config: CreditConfig; onSaved: (c: CreditConfig) => void }) {
  const [tope, setTope] = useState(String(config.topeCents / 100));
  const [dias, setDias] = useState(String(config.vencimientoDias));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ config: CreditConfig }>("/api/admin/saldo", {
        method: "PUT",
        body: JSON.stringify({ topePesos: Number(tope), vencimientoDias: Number(dias) }),
      });
      onSaved(r.config);
      setMsg({ ok: true, text: "Guardado." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "No se pudo guardar." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="neumorphic rounded-2xl p-5 flex flex-col gap-3" aria-labelledby="saldo-config">
      <h2 id="saldo-config" className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Reglas</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tope por reclamo ($)" type="number" min={0} step="0.01" inputMode="decimal" value={tope} onChange={(e) => setTope(e.target.value)} hint="0 = sin tope. Un reclamo no puede acreditar más que esto." />
        <Field label="Vencimiento (días)" type="number" min={0} step={1} inputMode="numeric" value={dias} onChange={(e) => setDias(e.target.value)} hint="0 = no vence. Aplica a lo que se acredite desde ahora; lo anterior no vence." />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={busy}>Guardar reglas</Button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm font-bold ${msg.ok ? "text-green-700" : "text-red-600"}`}>{msg.text}</p>}
      </div>
    </form>
  );
}

function AdjustForm({ client, onDone }: { client: CreditClient; onDone: () => void }) {
  const [tipo, setTipo] = useState<"sumar" | "restar">("sumar");
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");
  // Una clave por operación: reintentar el mismo envío no duplica el movimiento.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/admin/saldo/ajuste", {
        method: "POST",
        body: JSON.stringify({ clientId: client.id, tipo, pesos: Number(monto), motivo, idempotencyKey: key }),
      });
      setMonto("");
      setMotivo("");
      setKey(crypto.randomUUID());
      setMsg({ ok: true, text: "Movimiento registrado." });
      onDone();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "No se pudo registrar." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-label="Cargar saldo manualmente">
      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-xs text-gray-500 flex flex-col gap-1">
          Operación
          <select className="rounded-xl neumorphic-inset px-3 py-2 text-sm text-gray-800" value={tipo} onChange={(e) => setTipo(e.target.value as "sumar" | "restar")}>
            <option value="sumar">Sumar saldo</option>
            <option value="restar">Restar saldo</option>
          </select>
        </label>
        <Field label="Monto ($)" type="number" min={0.01} step="0.01" inputMode="decimal" required value={monto} onChange={(e) => setMonto(e.target.value)} />
      </div>
      <Field as="textarea" label="Motivo (obligatorio)" required rows={2} maxLength={200} value={motivo} onChange={(e) => setMotivo(e.target.value)} hint="Queda registrado con tu usuario y la fecha." />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={busy || !monto || motivo.trim().length < 3}>{tipo === "sumar" ? "Sumar saldo" : "Restar saldo"}</Button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm font-bold ${msg.ok ? "text-green-700" : "text-red-600"}`}>{msg.text}</p>}
      </div>
    </form>
  );
}

function ClientPanel({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [data, setData] = useState<CreditHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    api<CreditHistory>(`/api/admin/saldo?cliente=${encodeURIComponent(id)}`)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "No se pudo cargar."));
    return () => {
      alive = false;
    };
  }, [id, version]);

  if (error) return <p role="alert" className="text-sm font-bold text-red-600">{error}</p>;
  if (!data) return <div className="h-32 rounded-2xl shimmer" aria-hidden />;

  return (
    <section className="neumorphic rounded-2xl p-5 flex flex-col gap-4" aria-label={`Saldo de ${data.client.name}`}>
      <header>
        <h2 className="font-headline text-lg font-black text-gray-800">{data.client.name}</h2>
        <p className="text-sm text-gray-500">{data.client.phone ?? "Sin teléfono"} · Saldo actual: <strong className="text-gray-800">{money(data.client.creditCents)}</strong></p>
      </header>
      <AdjustForm client={data.client} onDone={() => { setVersion((v) => v + 1); onChanged(); }} />
      <div>
        <h3 className="text-xs font-bold text-gray-600 mb-1">Historial</h3>
        {data.movements.length === 0 ? (
          <p className="text-sm text-gray-500">Sin movimientos.</p>
        ) : (
          <ol className="space-y-1.5">
            {data.movements.map((m) => (
              <li key={m.id} className="text-xs text-gray-600 flex flex-col">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-gray-500">{fmt(m.createdAt)}</span>
                  <Badge tone={m.deltaCents < 0 ? "red" : "green"}>{m.deltaCents < 0 ? "−" : "+"}{money(Math.abs(m.deltaCents))}</Badge>
                  <span className="text-gray-800 font-bold">{MOTIVO_LABEL[m.motivo] ?? m.motivo}</span>
                  {m.expiresAt && m.deltaCents > 0 && <span className="text-gray-500">vence {fmt(m.expiresAt)}</span>}
                </span>
                {m.description && <span className="text-gray-700 whitespace-pre-wrap">{m.description}</span>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

export default function SaldoPage() {
  const [config, setConfig] = useState<CreditConfig | null>(null);
  const [clients, setClients] = useState<CreditClient[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (q: string) => {
    try {
      const r = await api<{ config: CreditConfig; clients: CreditClient[] }>(`/api/admin/saldo?q=${encodeURIComponent(q)}`);
      setConfig(r.config);
      setClients(r.clients);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo cargar.");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    api<{ config: CreditConfig; clients: CreditClient[] }>("/api/admin/saldo?q=")
      .then((r) => alive && (setConfig(r.config), setClients(r.clients)))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "No se pudo cargar."));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="page-fade flex flex-col gap-4 p-2">
      <header>
        <h1 className="font-headline text-2xl font-black text-gray-800">Saldo a favor</h1>
        <p className="text-sm text-gray-500 mt-1 max-w-2xl">
          Crédito en pesos de los clientes: se otorga al resolver reclamos y se descuenta en la próxima compra. Acá definís
          el tope por reclamo, el vencimiento y podés sumar o restar saldo a mano. Solo el dueño.
        </p>
      </header>

      {error && <p role="alert" className="text-sm font-bold text-red-600">{error}</p>}
      {config && <ConfigCard config={config} onSaved={setConfig} />}

      <section className="flex flex-col gap-3" aria-label="Clientes">
        <form
          className="flex gap-2 items-end max-w-xl"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            void load(query);
          }}
        >
          <div className="flex-1">
            <Field label="Buscar cliente (nombre o teléfono)" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={80} icon={<Search size={16} aria-hidden />} />
          </div>
          <Button type="submit" size="sm">Buscar</Button>
        </form>
        {!query.trim() && clients.length > 0 && <p className="text-xs text-gray-500">Clientes con saldo hoy.</p>}
        <ul className="grid gap-2 sm:grid-cols-2">
          {clients.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setSelected(c.id)}
                aria-pressed={selected === c.id}
                className={`w-full text-left rounded-xl px-4 py-3 text-sm ${selected === c.id ? "neumorphic-inset" : "neumorphic neumorphic-hover"}`}
              >
                <span className="font-bold text-gray-800 block">{c.name}</span>
                <span className="text-gray-500">{c.phone ?? "Sin teléfono"} · {money(c.creditCents)}</span>
              </button>
            </li>
          ))}
        </ul>
        {clients.length === 0 && <p className="text-sm text-gray-500">{query.trim() ? "Sin resultados." : "Ningún cliente tiene saldo ahora. Buscá uno para cargarle."}</p>}
      </section>

      {selected && <ClientPanel key={selected} id={selected} onChanged={() => void load(query)} />}
    </div>
  );
}
