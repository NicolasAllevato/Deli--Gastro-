import { parseFudoAddress, phoneKey } from "./sales.ts";

/**
 * Clientes de Fudo -> `clients`. Sin I/O. Se vinculan por `fudo_customer_id`; si no, por teléfono con un cliente
 * de la app todavía sin vincular. A un cliente existente solo se le completan los campos vacíos: nunca se pisa
 * lo que cargó la persona. Los nuevos entran sin login (`user_id` null) y sin consentimiento de marketing.
 */

export interface FudoCustomer {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  active: boolean;
}

export interface ExistingClient {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  fudo_customer_id: number | null;
}

export interface ClientInsert {
  fudo_customer_id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  source: "fudo";
}

export interface ClientUpdate {
  id: string;
  fudo_customer_id?: number;
  phone?: string;
  email?: string;
  address?: string;
}

export interface CustomersPlan {
  inserts: ClientInsert[];
  updates: ClientUpdate[];
}

const NAME_MAX = 120;
type Entry = Record<string, unknown>;
const isObject = (v: unknown): v is Entry => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function parseFudoCustomers(raw: unknown): FudoCustomer[] {
  const list = isObject(raw) && Array.isArray(raw.data) ? raw.data : Array.isArray(raw) ? raw : [];
  const out: FudoCustomer[] = [];
  for (const e of list) {
    if (!isObject(e) || !isObject(e.attributes)) continue;
    const id = Number(e.id);
    const a = e.attributes;
    const name = str(a.name);
    if (!Number.isInteger(id) || id <= 0 || !name) continue;
    out.push({
      id,
      name: name.slice(0, NAME_MAX),
      phone: str(a.phone),
      email: str(a.email)?.toLowerCase() ?? null,
      address: parseFudoAddress(str(a.address)),
      active: a.active !== false,
    });
  }
  return out;
}

const blank = (v: string | null | undefined): boolean => !v || !v.trim();

export function planCustomersImport(input: { customers: FudoCustomer[]; existing: ExistingClient[] }): CustomersPlan {
  const plan: CustomersPlan = { inserts: [], updates: [] };
  const byFudoId = new Map(input.existing.filter((c) => c.fudo_customer_id !== null).map((c) => [c.fudo_customer_id as number, c]));
  const unlinkedByPhone = new Map<string, ExistingClient>();
  for (const c of input.existing) {
    const key = phoneKey(c.phone);
    if (c.fudo_customer_id === null && key && !unlinkedByPhone.has(key)) unlinkedByPhone.set(key, c);
  }
  const usedPhones = new Set<string>();

  for (const fc of input.customers) {
    const key = phoneKey(fc.phone);
    const linked = byFudoId.get(fc.id);
    const match = linked ?? (key ? unlinkedByPhone.get(key) : undefined);

    if (match) {
      if (!linked && key) unlinkedByPhone.delete(key); // un cliente de la app se vincula a un solo cliente de Fudo
      const update: ClientUpdate = { id: match.id };
      if (match.fudo_customer_id !== fc.id && !linked) update.fudo_customer_id = fc.id;
      if (blank(match.phone) && fc.phone) update.phone = fc.phone;
      if (blank(match.email) && fc.email) update.email = fc.email;
      if (blank(match.address) && fc.address) update.address = fc.address;
      if (Object.keys(update).length > 1) plan.updates.push(update);
      if (key) usedPhones.add(key);
      continue;
    }

    // Solo se crean los que sirven para contactar: activos y con teléfono o email; sin duplicar teléfonos.
    if (!fc.active || (!key && !fc.email) || (key && usedPhones.has(key))) continue;
    if (key) usedPhones.add(key);
    plan.inserts.push({ fudo_customer_id: fc.id, name: fc.name, phone: fc.phone, email: fc.email, address: fc.address, source: "fudo" });
  }
  return plan;
}
