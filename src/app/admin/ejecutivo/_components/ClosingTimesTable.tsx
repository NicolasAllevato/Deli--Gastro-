import type { ClosingTimeRow } from "@/lib/reports/executive";
import { CHANNEL_LABELS } from "./format";

const nf = (n: number, digits = 0) => n.toLocaleString("es-AR", { maximumFractionDigits: digits });
const SOURCE_LABEL: Record<ClosingTimeRow["source"], string> = { cierre: "Cierre en caja", entrega: "Entrega real" };

/** Mediana por canal. Se rotula «cierre» porque Fudo no registra cuándo se entregó el pedido. */
export function ClosingTimesTable({ rows }: { rows: ClosingTimeRow[] }) {
  return (
    <section className="exec-card p-4 sm:p-5 flex flex-col gap-3 min-w-0" data-testid="tiempos-canal">
      <div>
        <h2 className="font-headline font-black text-base">Tiempo hasta el cierre por canal</h2>
        <p className="text-xs exec-muted mt-0.5">
          Desde que entra el pedido hasta que se cierra. En Fudo es el cierre en caja, no la entrega real: sirve para comparar, no como tiempo exacto.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm exec-muted py-10 text-center">Sin datos para este período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Mediana de minutos hasta el cierre por canal de venta</caption>
            <thead>
              <tr className="text-xs exec-muted text-right">
                <th scope="col" className="text-left font-semibold py-2 pr-3">Canal</th>
                <th scope="col" className="text-left font-semibold py-2 px-2">Medición</th>
                <th scope="col" className="font-semibold py-2 px-2">Mediana</th>
                <th scope="col" className="font-semibold py-2 px-2">Medidos</th>
                <th scope="col" className="font-semibold py-2 px-2">Más de 4 h</th>
                <th scope="col" className="font-semibold py-2 pl-2">Sin hora</th>
              </tr>
            </thead>
            <tbody className="tabular-nums text-right">
              {rows.map((r) => {
                const onlyPickup = r.measured + r.excluded + r.withoutTime === 0;
                return (
                  <tr key={r.channel} className="border-t border-current/10">
                    <th scope="row" className="text-left font-semibold py-2 pr-3">{CHANNEL_LABELS[r.channel] ?? r.channel}</th>
                    <td className="text-left py-2 px-2 exec-muted">{onlyPickup ? "No medible" : SOURCE_LABEL[r.source]}</td>
                    <td className="py-2 px-2 font-bold">{r.medianMinutes === null ? "—" : `${nf(r.medianMinutes, 1)} min`}</td>
                    <td className="py-2 px-2">{nf(r.measured)}</td>
                    <td className="py-2 px-2">{nf(r.excluded)}</td>
                    <td className="py-2 pl-2">{nf(r.withoutTime)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs exec-muted">«No medible»: take away y mostrador se cargan al cobrar, así que su tiempo no dice nada.</p>
    </section>
  );
}
