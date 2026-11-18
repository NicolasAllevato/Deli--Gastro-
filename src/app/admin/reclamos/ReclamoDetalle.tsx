"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { formatDateTimeAR } from "@/lib/time-ar";
import { CATEGORIA_LABEL } from "@/lib/reclamos/categoria";
import { ESTADO_BADGE, ESTADO_LABEL, call, type ReclamoDetalleData } from "./shared";

const fecha = (iso: string) => formatDateTimeAR(iso, { dateStyle: "short", timeStyle: "short" });
const money = (cents: number) => `$${(cents / 100).toLocaleString("es-AR")}`;
const inputClass = "w-full neumorphic-inset rounded-xl px-3 py-2 text-sm text-gray-800 bg-transparent";

type Compensacion = "" | "puntos" | "descuento";

interface Props {
  id: string;
  onChanged: () => void;
}

/** Detalle de un reclamo: pedido, fotos, historial y acciones (tomar, nota, responder, resolver). */
export function ReclamoDetalle({ id, onChanged }: Props) {
  const [r, setR] = useState<ReclamoDetalleData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [nota, setNota] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [resolucion, setResolucion] = useState("");
  const [compTipo, setCompTipo] = useState<Compensacion>("");
  const [compValor, setCompValor] = useState("");

  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    call<{ reclamo: ReclamoDetalleData }>(`/api/admin/reclamos/${id}`)
      .then((data) => {
        if (!alive) return;
        setR(data.reclamo);
        setError(null);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "No se pudo cargar.");
      });
    return () => {
      alive = false;
    };
  }, [id, version]);

  async function act(body: Record<string, unknown>, done?: () => void) {
    setBusy(true);
    setError(null);
    setAviso(null);
    try {
      const res = await call<{ aviso?: string; puntosAcreditados?: number }>(`/api/admin/reclamos/${id}`, body);
      done?.();
      if (res.aviso) setAviso(`Guardado, pero el WhatsApp no salió: ${res.aviso}`);
      else if (res.puntosAcreditados) setAviso(`Se acreditaron ${res.puntosAcreditados} puntos y se le avisó al cliente.`);
      setVersion((v) => v + 1);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la operación.");
    } finally {
      setBusy(false);
    }
  }

  function resolver() {
    const valor = Number(compValor);
    const compensacion = compTipo && Number.isInteger(valor) && valor > 0 ? { tipo: compTipo, valor } : null;
    if (compTipo && !compensacion) {
      setError("Indicá un valor entero mayor a 0 para la compensación.");
      return;
    }
    void act({ accion: "resolver", resolucion, compensacion }, () => {
      setResolucion("");
      setCompTipo("");
      setCompValor("");
    });
  }

  if (error && !r) return <p role="alert" className="text-sm font-bold text-red-600 p-4">{error}</p>;
  if (!r) return <p className="text-sm text-gray-500 p-4">Cargando...</p>;

  return (
    <article className="neumorphic rounded-2xl p-5 space-y-4">
      <header className="space-y-1">
        <h3 className="text-base font-bold text-gray-800 flex flex-wrap items-center gap-2">
          Reclamo #{r.numero} <span className={ESTADO_BADGE[r.estado]}>{ESTADO_LABEL[r.estado]}</span>
          <span className="text-xs font-normal text-gray-500">{CATEGORIA_LABEL[r.categoria]}</span>
        </h3>
        <p className="text-xs text-gray-500">
          {r.client_name ?? "Sin nombre"} · {r.client_phone} · {fecha(r.created_at)}
          {r.notified_at ? " · Local avisado por mail" : " · Sin aviso por mail"}
        </p>
        <Link href="/admin/conversaciones" className="text-xs font-bold text-brand-orange hover:underline">
          Ver la conversación (buscá {r.client_phone})
        </Link>
      </header>

      <p className="text-sm text-gray-800 whitespace-pre-wrap">{r.motivo}</p>

      {r.pedido && (
        <div className="neumorphic-inset rounded-xl p-3 text-xs text-gray-600">
          <p className="font-bold text-gray-800">Pedido #{r.pedido.id.slice(0, 8).toUpperCase()} · {r.pedido.status}</p>
          <p>{r.pedido.items_desc}</p>
          <p>{money(r.pedido.total_cents)} · {fecha(r.pedido.created_at)}</p>
        </div>
      )}

      {r.foto_keys.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Fotos del cliente">
          {r.foto_keys.map((key, i) => {
            const src = `/api/admin/reclamos/${r.id}/foto?key=${encodeURIComponent(key)}`;
            return (
              <li key={key}>
                <a href={src} target="_blank" rel="noreferrer">
                  {/* Foto privada servida por una ruta solo para admins: next/image no aplica. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`Foto ${i + 1} del reclamo #${r.numero}`} className="w-24 h-24 object-cover rounded-xl" />
                </a>
              </li>
            );
          })}
        </ul>
      )}

      {r.resolucion && (
        <p className="text-sm text-gray-700">
          <strong>Resolución:</strong> {r.resolucion}
          {r.compensacion_tipo === "puntos" && ` · ${r.compensacion_valor} puntos`}
          {r.compensacion_tipo === "descuento" && ` · ${r.compensacion_valor}% de descuento (aplicar a mano en el próximo pedido)`}
        </p>
      )}

      {error && <p role="alert" className="text-xs font-bold text-red-600">{error}</p>}
      {aviso && <p role="status" className="text-xs font-bold text-gray-700">{aviso}</p>}

      <div className="flex flex-wrap gap-2">
        {r.estado === "abierto" && <Button size="sm" disabled={busy} onClick={() => void act({ accion: "tomar" })}>Tomar</Button>}
        {r.estado === "resuelto" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act({ accion: "reabrir" })}>Reabrir</Button>}
      </div>

      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void act({ accion: "nota", texto: nota }, () => setNota("")); }}>
        <label className="text-xs font-bold text-gray-600 block" htmlFor="reclamo-nota">Nota interna</label>
        <textarea id="reclamo-nota" className={inputClass} rows={2} maxLength={1000} value={nota} onChange={(e) => setNota(e.target.value)} />
        <Button size="sm" variant="secondary" type="submit" disabled={busy || !nota.trim()}>Agregar nota</Button>
      </form>

      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void act({ accion: "responder", texto: mensaje }, () => setMensaje("")); }}>
        <label className="text-xs font-bold text-gray-600 block" htmlFor="reclamo-mensaje">Responder por WhatsApp (dentro de las 24 h)</label>
        <textarea id="reclamo-mensaje" className={inputClass} rows={2} maxLength={1000} value={mensaje} onChange={(e) => setMensaje(e.target.value)} />
        <Button size="sm" type="submit" disabled={busy || !mensaje.trim()}>Enviar</Button>
      </form>

      {r.estado !== "resuelto" && (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); resolver(); }}>
          <label className="text-xs font-bold text-gray-600 block" htmlFor="reclamo-resolucion">Resolución (se le envía al cliente)</label>
          <textarea id="reclamo-resolucion" className={inputClass} rows={2} maxLength={1000} value={resolucion} onChange={(e) => setResolucion(e.target.value)} />
          <div className="flex flex-wrap gap-2 items-end">
            <label className="text-xs text-gray-500 flex flex-col gap-1">
              Compensación
              <select className={inputClass} value={compTipo} onChange={(e) => setCompTipo(e.target.value as Compensacion)}>
                <option value="">Sin compensación</option>
                <option value="puntos">Puntos</option>
                <option value="descuento">Descuento próximo pedido (%)</option>
              </select>
            </label>
            {compTipo && (
              <label className="text-xs text-gray-500 flex flex-col gap-1">
                {compTipo === "puntos" ? "Puntos" : "Porcentaje"}
                <input type="number" min={1} max={compTipo === "puntos" ? 10000 : 100} className={inputClass} value={compValor} onChange={(e) => setCompValor(e.target.value)} />
              </label>
            )}
          </div>
          <Button size="sm" type="submit" disabled={busy || !resolucion.trim()}>Resolver y avisar al cliente</Button>
        </form>
      )}

      <section aria-label="Historial">
        <h4 className="text-xs font-bold text-gray-600 mb-1">Historial</h4>
        <ol className="space-y-1">
          {r.eventos.map((ev) => (
            <li key={ev.id} className="text-xs text-gray-600">
              <span className="text-gray-500">{fecha(ev.created_at)} · {ev.autor} · {ev.tipo}</span>
              {ev.detalle && <span className="block text-gray-800 whitespace-pre-wrap">{ev.detalle}</span>}
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
