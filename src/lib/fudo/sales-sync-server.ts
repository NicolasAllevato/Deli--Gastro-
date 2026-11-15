import { dataFor, systemActor, usesD1 } from "@/lib/data";
import { fudoWriteGateway } from "@/lib/fudo/sales-gateway";

/**
 * Reacción del servidor a un cambio de estado de pedido: crea/cobra/cierra/anula la venta en Fudo.
 * Solo con D1 como fuente (DATA_BACKEND=d1|dual): con Supabase no existen las columnas de venta.
 * Nunca tira: un error queda en el log y el pedido, si corresponde, como pendiente de sincronizar.
 */
export async function syncFudoSaleAfterStatus(orderId: string, status: string, reason: string): Promise<void> {
  if (!usesD1()) return;
  try {
    const data = await dataFor(systemActor(reason));
    await data.fudoSales.onStatus(fudoWriteGateway(), orderId, status);
  } catch (error: unknown) {
    console.error("[fudo-sales]", orderId, error instanceof Error ? error.message : String(error));
  }
}
