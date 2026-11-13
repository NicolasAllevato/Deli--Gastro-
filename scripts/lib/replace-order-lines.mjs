// Reemplazo seguro de las order_items de un pedido (backfill de Fudo). Sin dependencias: recibe `rest`.
//
// Orden: 1) leer las filas viejas (ids y contenido, para el respaldo); 2) INSERTAR las nuevas; 3) recién entonces
// BORRAR las viejas por id. Si el insert falla, no se borró nada: el pedido conserva sus líneas. Si el delete falla,
// quedan viejas y nuevas juntas y la función lanza; el pedido sigue sin corregir (items_desc no se tocó) y una
// nueva corrida vuelve a insertar y borra TODAS las anteriores, así que converge.

/**
 * @param {(path: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => Promise<unknown>} rest
 * @param {string} orderId
 * @param {Array<Record<string, unknown>>} rows filas nuevas (ya con order_id)
 * @param {(previous: Array<Record<string, unknown>>) => void} [backup] se llama ANTES de escribir nada (respaldo local)
 * @returns {Promise<{ previous: Array<Record<string, unknown>> }>} filas que había antes (para el respaldo)
 */
export async function replaceOrderLines(rest, orderId, rows, backup = () => {}) {
  const previous = /** @type {Array<Record<string, unknown>>} */ (
    (await rest(`order_items?order_id=eq.${encodeURIComponent(orderId)}&select=*`)) ?? []
  );
  backup(previous);
  if (rows.length === 0) return { previous };
  await rest("order_items", { method: "POST", body: JSON.stringify(rows) });
  const oldIds = previous.map((r) => r.id).filter((id) => typeof id === "string");
  if (oldIds.length) {
    await rest(`order_items?order_id=eq.${encodeURIComponent(orderId)}&id=in.(${oldIds.map(encodeURIComponent).join(",")})`, { method: "DELETE" });
  }
  return { previous };
}
