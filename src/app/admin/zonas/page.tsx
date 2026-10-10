"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Circle as CircleIcon, Hexagon, MapPin, Pencil, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Switch } from "@/components/ui/Switch";
import { formatMoney } from "@/lib/orders";
import { RESTAURANT_LOCATION } from "@/lib/restaurant";
import type { DeliveryZone, GeoPoint, ZoneShape } from "@/lib/zones";

const ZoneEditorMap = dynamic(() => import("./ZoneEditorMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[420px] flex items-center justify-center rounded-2xl neumorphic-inset text-gray-500 animate-pulse">
      <MapPin className="w-8 h-8" aria-hidden />
    </div>
  ),
});

type Tool = "circle" | "polygon" | "local";

interface Draft {
  id: string | null;
  name: string;
  fee: string;
  minOrder: string;
  radiusKm: string;
  isActive: boolean;
  center: GeoPoint | null;
  points: Array<[number, number]>;
}

const EMPTY_DRAFT: Draft = {
  id: null, name: "", fee: "", minOrder: "0", radiusKm: "2", isActive: true, center: null, points: [],
};

function draftFromZone(zone: DeliveryZone): { draft: Draft; tool: Tool } {
  const base = {
    ...EMPTY_DRAFT,
    id: zone.id,
    name: zone.name,
    fee: String(zone.fee),
    minOrder: String(zone.min_order),
    isActive: zone.is_active,
  };
  if (zone.shape.type === "circle") {
    const { lat, lng, radius_km } = zone.shape;
    return { draft: { ...base, center: { lat, lng }, radiusKm: String(radius_km) }, tool: "circle" };
  }
  return { draft: { ...base, points: zone.shape.points.map(([lat, lng]) => [lat, lng]) }, tool: "polygon" };
}

function shapeOf(draft: Draft, tool: Tool | null): ZoneShape | null {
  if (tool === "circle" && draft.center) {
    const radius = Number(draft.radiusKm);
    return { type: "circle", ...draft.center, radius_km: Number.isFinite(radius) && radius > 0 ? radius : 0.1 };
  }
  if (tool === "polygon" && draft.points.length > 0) return { type: "polygon", points: draft.points };
  return null;
}

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

export default function ZonasPage() {
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [local, setLocal] = useState<GeoPoint>(RESTAURANT_LOCATION);
  const [radiusKm, setRadiusKm] = useState("8");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [tool, setTool] = useState<Tool | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [data, config] = await Promise.all([
        request<{ zones: DeliveryZone[]; local: GeoPoint }>("/api/zones"),
        request<Record<string, unknown>>("/api/config"),
      ]);
      setZones(data.zones);
      setLocal(data.local);
      if (typeof config.radio_delivery_km === "number") setRadiusKm(String(config.radio_delivery_km));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las zonas.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const run = async (action: () => Promise<void>, success?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (success) setNotice(success);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo completar la operación.");
    } finally {
      setBusy(false);
    }
  };

  const draftShape = useMemo(() => shapeOf(draft, tool), [draft, tool]);
  const editing = tool === "circle" || tool === "polygon";

  const handlePick = (point: GeoPoint) => {
    if (tool === "circle") setDraft((d) => ({ ...d, center: point }));
    else if (tool === "polygon") setDraft((d) => ({ ...d, points: [...d.points, [point.lat, point.lng]] }));
    else if (tool === "local") {
      setTool(null);
      void run(async () => {
        await request("/api/config", send("PATCH", { local_lat: point.lat, local_lng: point.lng }));
      }, "Ubicación del local actualizada.");
    }
  };

  const startNew = (next: "circle" | "polygon") => {
    setDraft(EMPTY_DRAFT);
    setTool(next);
    setError(null);
    setNotice(null);
  };

  const cancel = () => {
    setDraft(EMPTY_DRAFT);
    setTool(null);
  };

  const save = () => {
    if (!draftShape || (draftShape.type === "polygon" && draftShape.points.length < 3)) {
      setError(draftShape?.type === "polygon" ? "Marcá al menos 3 puntos en el mapa." : "Tocá el mapa para ubicar el centro.");
      return;
    }
    const body = {
      name: draft.name,
      shape: draftShape,
      fee: Number(draft.fee),
      min_order: Number(draft.minOrder),
      is_active: draft.isActive,
      sort_order: draft.id ? undefined : zones.length,
    };
    void run(async () => {
      await request("/api/zones", draft.id ? send("PATCH", { id: draft.id, ...body }) : send("POST", body));
      cancel();
    }, "Zona guardada.");
  };

  const remove = (zone: DeliveryZone) => {
    if (!confirm(`¿Eliminar la zona "${zone.name}"?`)) return;
    void run(async () => {
      await request("/api/zones", send("DELETE", { id: zone.id }));
      if (draft.id === zone.id) cancel();
    }, "Zona eliminada.");
  };

  const toggle = (zone: DeliveryZone) =>
    void run(() => request("/api/zones", send("PATCH", { id: zone.id, is_active: !zone.is_active })).then(() => undefined));

  const saveRadius = () =>
    void run(async () => {
      await request("/api/config", send("PATCH", { radio_delivery_km: Number(radiusKm) }));
    }, "Radio actualizado.");

  const edit = (zone: DeliveryZone) => {
    const next = draftFromZone(zone);
    setDraft(next.draft);
    setTool(next.tool);
    setError(null);
    setNotice(null);
  };

  return (
    <div className="space-y-5 max-w-5xl mx-auto pb-10">
      <div>
        <h1 className="font-headline font-black text-xl text-gray-800 tracking-tight">Zonas de entrega</h1>
        <p className="text-gray-500 text-xs mt-0.5 font-medium">
          Dibujá dónde entregás y cuánto cobrás en cada zona. Sin zonas activas se usa el radio de abajo.
        </p>
      </div>

      {error && <p role="alert" className="text-xs font-bold text-red-600 px-3 py-2 rounded-lg bg-red-50 border border-red-100">{error}</p>}
      {notice && <p role="status" className="text-xs font-bold text-green-700 px-3 py-2 rounded-lg bg-green-50 border border-green-100">{notice}</p>}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => startNew("circle")} leftIcon={<CircleIcon size={14} aria-hidden />}>Zona circular</Button>
        <Button size="sm" variant="secondary" onClick={() => startNew("polygon")} leftIcon={<Hexagon size={14} aria-hidden />}>Zona libre (polígono)</Button>
        <Button size="sm" variant="secondary" onClick={() => setTool(tool === "local" ? null : "local")} leftIcon={<MapPin size={14} aria-hidden />}>
          {tool === "local" ? "Tocá el mapa para ubicar el local" : "Mover el local"}
        </Button>
      </div>

      <div className="neumorphic rounded-2xl p-1 overflow-hidden">
        <ZoneEditorMap
          zones={zones}
          local={local}
          draft={draftShape}
          editingId={draft.id}
          picking={tool !== null}
          onPick={handlePick}
        />
      </div>

      {editing && (
        <section className="neumorphic rounded-2xl p-5 space-y-4" aria-label="Datos de la zona">
          <p className="text-xs text-gray-500 font-medium">
            {tool === "circle"
              ? "Tocá el mapa para ubicar el centro y ajustá el radio."
              : `Tocá el mapa para marcar los vértices (${draft.points.length} marcados, mínimo 3).`}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Nombre" value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <Field label="Costo de envío ($)" type="number" min={0} value={draft.fee} onChange={(e) => setDraft({ ...draft, fee: e.target.value })} />
            <Field label="Pedido mínimo ($)" type="number" min={0} value={draft.minOrder} onChange={(e) => setDraft({ ...draft, minOrder: e.target.value })} />
            {tool === "circle" && (
              <Field label="Radio (km)" type="number" min={0.1} step={0.1} value={draft.radiusKm} onChange={(e) => setDraft({ ...draft, radiusKm: e.target.value })} />
            )}
          </div>
          <Switch checked={draft.isActive} onChange={(isActive) => setDraft({ ...draft, isActive })} label="Zona activa" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={save} loading={busy}>Guardar zona</Button>
            {tool === "polygon" && (
              <Button size="sm" variant="secondary" onClick={() => setDraft({ ...draft, points: draft.points.slice(0, -1) })} disabled={draft.points.length === 0} leftIcon={<Undo2 size={14} aria-hidden />}>
                Deshacer punto
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={cancel}>Cancelar</Button>
          </div>
        </section>
      )}

      <section aria-label="Zonas guardadas" className="space-y-2">
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest px-1">Zonas ({zones.length})</p>
        {zones.length === 0 ? (
          <div className="neumorphic-inset rounded-xl p-6 text-center text-sm text-gray-500">
            Todavía no hay zonas. Se usa el radio máximo con costo por kilómetro.
          </div>
        ) : (
          zones.map((zone) => (
            <div key={zone.id} className="neumorphic rounded-xl p-3.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-gray-800 truncate">{zone.name}</p>
                <p className="text-xs text-gray-500">
                  {zone.shape.type === "circle" ? `Radio ${zone.shape.radius_km} km` : `Polígono de ${zone.shape.points.length} puntos`}
                  {" · "}{formatMoney(zone.fee)}
                  {zone.min_order > 0 ? ` · mínimo ${formatMoney(zone.min_order)}` : ""}
                </p>
              </div>
              <Switch checked={zone.is_active} onChange={() => toggle(zone)} aria-label={`Activar zona ${zone.name}`} />
              <Button variant="icon" size="sm" aria-label={`Editar zona ${zone.name}`} onClick={() => edit(zone)}><Pencil size={14} aria-hidden /></Button>
              <Button variant="icon" size="sm" aria-label={`Eliminar zona ${zone.name}`} onClick={() => remove(zone)}><Trash2 size={14} aria-hidden /></Button>
            </div>
          ))
        )}
      </section>

      <section className="neumorphic rounded-2xl p-5 space-y-3">
        <h2 className="font-headline font-bold text-sm uppercase tracking-widest text-gray-700">Radio sin zonas</h2>
        <p className="text-xs text-gray-500">Se usa cuando no hay ninguna zona activa. El envío se calcula con el costo por km de Configuración.</p>
        <div className="flex items-end gap-3">
          <div className="flex-1"><Field label="Radio máximo (km)" type="number" min={1} value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} /></div>
          <Button size="sm" variant="secondary" onClick={saveRadius} loading={busy}>Guardar</Button>
        </div>
      </section>
    </div>
  );
}
