import Link from "next/link";
import { ClipboardList, Clock, MapPinned, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Ruler } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { EMPTY, ORDER_TRACE_SECTIONS, formatTraceValue, tracePoints, type TraceField, type TraceSection } from "@/lib/orders-trace";
import { distanceMeters } from "@/lib/delivery-metrics";
import TraceMapLoader from "./TraceMapLoader";

const SECTION_ICON: Record<TraceSection["id"], LucideIcon> = {
  pedido: ClipboardList,
  tiempos: Clock,
  entrega: MapPinned,
  fudo: RefreshCw,
};

function Value({ field, value }: { field: TraceField; value: unknown }) {
  const text = formatTraceValue(value, field.kind);
  const empty = text === EMPTY;

  if (field.kind === "client" && !empty) {
    return (
      <Link
        href={`/admin/puntos?cliente=${encodeURIComponent(text)}`}
        className="font-mono text-xs text-brand-orange underline underline-offset-2 break-all"
        aria-label={`Ver ficha del cliente ${text}`}
      >
        {text}
      </Link>
    );
  }
  if (field.kind === "json" && !empty) {
    return <pre className="text-xs whitespace-pre-wrap break-all rounded-lg neumorphic-inset p-2 text-gray-700">{text}</pre>;
  }
  if (field.kind === "error" && !empty) {
    return (
      <span role="alert" className="inline-flex items-start gap-1.5 rounded-lg badge-red px-2 py-1 text-xs font-bold break-all">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden /> {text}
      </span>
    );
  }
  if (field.kind === "bool" && !empty) {
    const yes = text === "Sí";
    const Icon = yes ? CheckCircle2 : XCircle;
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-700">
        <Icon className={yes ? "w-4 h-4 text-green-600" : "w-4 h-4 text-gray-500"} aria-hidden /> {text}
      </span>
    );
  }
  return <span className={empty ? "text-gray-500" : "text-sm text-gray-700 break-words"}>{text}</span>;
}

/** Todas las columnas del pedido, por sección. Los vacíos se muestran como "—". */
export default function OrderTrace({ order }: { order: Record<string, unknown> }) {
  const { requested, delivered } = tracePoints(order);
  const distance = requested && delivered ? distanceMeters(requested, delivered) : null;

  return (
    <section aria-labelledby="rastreo-titulo" className="space-y-4">
      <h2 id="rastreo-titulo" className="font-headline font-black text-lg text-gray-800 tracking-tight">Rastreo completo</h2>
      {ORDER_TRACE_SECTIONS.map((section) => {
        const Icon = SECTION_ICON[section.id];
        return (
          <div key={section.id} className="neumorphic p-5 rounded-2xl" data-trace-section={section.id}>
            <div className="flex items-center gap-2 mb-4 text-gray-700">
              <Icon className="w-4 h-4" aria-hidden />
              <h3 className="font-headline font-bold text-sm uppercase tracking-widest">{section.title}</h3>
            </div>

            {section.id === "entrega" && (
              <div className="mb-4 space-y-2">
                <TraceMapLoader requested={requested} delivered={delivered} />
                <p className="flex items-center gap-2 text-sm text-gray-700">
                  <Ruler className="w-4 h-4 text-gray-500" aria-hidden />
                  <span className="font-bold">Distancia entre el punto pedido y el de entrega:</span>
                  <span>{distance === null ? EMPTY : `${distance} m`}</span>
                </p>
              </div>
            )}

            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
              {section.fields.map((field) => (
                <div key={field.key} className="min-w-0" data-trace-field={field.key}>
                  <dt className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">
                    {field.label} <span className="font-mono normal-case tracking-normal">({field.key})</span>
                  </dt>
                  <dd className="mt-0.5">
                    <Value field={field} value={order[field.key]} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </section>
  );
}
