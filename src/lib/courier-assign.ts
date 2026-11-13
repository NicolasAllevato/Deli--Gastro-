/**
 * Modo de asignación de repartidores (`global_config.courier_assign_mode`). Sin imports: lo usan la app y
 * el Worker de Fudo, así los dos leen y deciden igual.
 * - libre (por defecto): el repartidor habilitado toma pedidos sin asignar; el admin también asigna.
 * - manual: solo el admin asigna; el repartidor no puede autoasignarse.
 * - automatico: al salir un delivery se asigna al habilitado con menos pedidos en curso.
 */

export const COURIER_ASSIGN_MODE_KEY = "courier_assign_mode";
export const COURIER_ASSIGN_MODES = ["libre", "manual", "automatico"] as const;
export type CourierAssignMode = (typeof COURIER_ASSIGN_MODES)[number];
export const DEFAULT_ASSIGN_MODE: CourierAssignMode = "libre";

/** Valor guardado → modo. Cualquier cosa desconocida o ausente cae en "libre". */
export function parseAssignMode(raw: unknown): CourierAssignMode {
  return (COURIER_ASSIGN_MODES as readonly unknown[]).includes(raw) ? (raw as CourierAssignMode) : DEFAULT_ASSIGN_MODE;
}

/** Solo en modo libre el repartidor puede tomar un pedido sin asignar. */
export function courierMaySelfAssign(mode: CourierAssignMode): boolean {
  return mode === "libre";
}

/**
 * Compuerta del PATCH del repartidor: si puede tocar el pedido según el modo. Lo suyo siempre;
 * uno sin asignar (o ajeno) solo en modo libre. Si es `false`, la API responde 403.
 */
export function courierMayActOn(mode: CourierAssignMode, currentCourier: string | null, ownName: string): boolean {
  return currentCourier === ownName || courierMaySelfAssign(mode);
}

export interface CourierCandidate {
  name: string;
  /** Pedidos en curso (asignados y sin entregar). */
  active: number;
  /** Última vez que recibió un pedido (ISO), o null si nunca. */
  lastAssignedAt: string | null;
}

/**
 * Repartidor que recibe el próximo delivery: el de menos pedidos en curso; empate, el que hace más tiempo
 * que no recibe uno (nunca = el primero); último desempate por nombre, para ser determinista.
 */
export function pickCourier(candidates: readonly CourierCandidate[]): string | null {
  const sorted = [...candidates].sort(
    (a, b) =>
      a.active - b.active ||
      (a.lastAssignedAt ?? "").localeCompare(b.lastAssignedAt ?? "") ||
      a.name.localeCompare(b.name),
  );
  return sorted[0]?.name ?? null;
}

export interface AssignableOrder {
  courier_name: string | null;
  channel: string | null | undefined;
  fudo_sale_type?: string | null;
  delivery_address?: string | null;
}

/** Si un pedido es un delivery (no take away): Fudo lo dice el tipo de venta; web/WhatsApp, la dirección. */
export function isDeliveryOrder(order: AssignableOrder): boolean {
  if (order.channel === "fudo") return order.fudo_sale_type === "DELIVERY";
  return Boolean(order.delivery_address?.trim());
}

/** Si el modo automático debe asignarle repartidor: delivery sin repartidor (nunca pisa uno asignado). */
export function needsAutoAssign(mode: CourierAssignMode, order: AssignableOrder): boolean {
  return mode === "automatico" && order.courier_name === null && isDeliveryOrder(order);
}

/** Arma los candidatos a partir de los habilitados, los pedidos en curso y las últimas asignaciones. */
export function buildCandidates(
  approvedNames: readonly string[],
  activeCourierNames: readonly (string | null)[],
  lastAssigned: ReadonlyMap<string, string>,
): CourierCandidate[] {
  return [...new Set(approvedNames)].map((name) => ({
    name,
    active: activeCourierNames.filter((n) => n === name).length,
    lastAssignedAt: lastAssigned.get(name) ?? null,
  }));
}

/**
 * Selector con estado para asignar varios pedidos en una misma corrida: cada asignación suma carga y
 * actualiza la última hora, así no van todos al mismo repartidor.
 */
export function courierPicker(candidates: readonly CourierCandidate[], now: string): () => string | null {
  const pool = candidates.map((c) => ({ ...c }));
  return () => {
    const name = pickCourier(pool);
    if (name === null) return null;
    const index = pool.findIndex((c) => c.name === name);
    pool[index] = { ...pool[index], active: pool[index].active + 1, lastAssignedAt: now };
    return name;
  };
}
