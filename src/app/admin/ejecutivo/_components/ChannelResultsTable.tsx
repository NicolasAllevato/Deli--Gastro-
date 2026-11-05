import type { ChannelRow } from "@/lib/reports/executive";
import { CHANNEL_LABELS, compactMoney } from "./format";

const nf = (n: number) => n.toLocaleString("es-AR");

/** Estado de resultados de pedidos: una fila por canal de venta, con totales. */
export function ChannelResultsTable({ channels }: { channels: ChannelRow[] }) {
  const total = channels.reduce(
    (acc, c) => ({
      orders: acc.orders + c.orders,
      delivered: acc.delivered + c.delivered,
      cancelled: acc.cancelled + c.cancelled,
      revenue: acc.revenue + c.revenue,
    }),
    { orders: 0, delivered: 0, cancelled: 0, revenue: 0 },
  );
  const avg = total.orders > 0 ? Math.round(total.revenue / total.orders) : null;

  return (
    <section className="exec-card p-4 sm:p-5 flex flex-col gap-3 min-w-0">
      <div>
        <h2 className="font-headline font-black text-base">Resultado de pedidos por canal</h2>
        <p className="text-xs exec-muted mt-0.5">Demanda y facturación de cada canal de venta, sin contar cancelados.</p>
      </div>
      {channels.length === 0 ? (
        <p className="text-sm exec-muted py-10 text-center">Sin datos para este período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Pedidos, entregas, cancelaciones y facturación por canal de venta</caption>
            <thead>
              <tr className="text-xs exec-muted text-right">
                <th scope="col" className="text-left font-semibold py-2 pr-3">Canal</th>
                <th scope="col" className="font-semibold py-2 px-2">Pedidos</th>
                <th scope="col" className="font-semibold py-2 px-2">Entregados</th>
                <th scope="col" className="font-semibold py-2 px-2">Cancelados</th>
                <th scope="col" className="font-semibold py-2 px-2">Facturación</th>
                <th scope="col" className="font-semibold py-2 px-2">Ticket prom.</th>
                <th scope="col" className="font-semibold py-2 pl-2">Part.</th>
              </tr>
            </thead>
            <tbody className="tabular-nums text-right">
              {channels.map((c) => (
                <tr key={c.channel} className="border-t border-current/10">
                  <th scope="row" className="text-left font-semibold py-2 pr-3">{CHANNEL_LABELS[c.channel] ?? c.channel}</th>
                  <td className="py-2 px-2">{nf(c.orders)}</td>
                  <td className="py-2 px-2">{nf(c.delivered)}</td>
                  <td className="py-2 px-2">{nf(c.cancelled)}</td>
                  <td className="py-2 px-2">{compactMoney(c.revenue)}</td>
                  <td className="py-2 px-2">{c.avgTicket === null ? "—" : `$${nf(c.avgTicket)}`}</td>
                  <td className="py-2 pl-2">{c.share.toLocaleString("es-AR")}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="tabular-nums text-right font-black">
              <tr className="border-t-2 border-current/20">
                <th scope="row" className="text-left py-2 pr-3">Total</th>
                <td className="py-2 px-2">{nf(total.orders)}</td>
                <td className="py-2 px-2">{nf(total.delivered)}</td>
                <td className="py-2 px-2">{nf(total.cancelled)}</td>
                <td className="py-2 px-2">{compactMoney(total.revenue)}</td>
                <td className="py-2 px-2">{avg === null ? "—" : `$${nf(avg)}`}</td>
                <td className="py-2 pl-2">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
