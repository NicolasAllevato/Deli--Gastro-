#!/usr/bin/env node
/**
 * Migración de datos Supabase → Cloudflare D1 (Deli-Gastro).
 *
 * Qué hace: EXPORTA (solo lectura) las tablas de la app desde Supabase, las
 * TRANSFORMA a los tipos de d1/schema/0001_inicial.sql y escribe un archivo SQL
 * idempotente (upsert ON CONFLICT DO UPDATE) más un SQL de verificación de conteos.
 * NO escribe en Supabase ni en D1: aplicar el SQL es un paso aparte y manual.
 *
 * Uso:
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/migrar-datos-d1.mjs [--out d1/out] [--tablas orders,clients]
 *   Las contraseñas NO se copian (decisión D3): los usuarios se crean en la
 *   tabla "user" de Better Auth sin cuenta de contraseña y la definen con
 *   "olvidé mi contraseña" en el corte. Montos → centavos enteros (D6).
 *
 * Después (SIEMPRE primero en local):
 *   npx wrangler d1 execute <db> --local --file d1/schema/0001_inicial.sql
 *   npx wrangler d1 execute <db> --local --file d1/out/datos.sql
 *   npx wrangler d1 execute <db> --local --file d1/out/verificar.sql
 *   y comparar contra d1/out/conteos.json.
 *
 * Idempotente: cada fila va como upsert por clave primaria, así que
 * correrlo de nuevo actualiza en vez de duplicar. Las tablas que se borran en
 * origen NO se borran en destino (usar --borrar para emitir DELETE previos).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

// Orden respetando FKs (padres primero).
const TABLAS = [
  "categories", "products", "clients", "orders", "order_items", "order_events",
  "points_ledger", "reviews", "payment_intents", "delivery_zones", "reports_daily",
  "couriers", "courier_locations", "courier_shifts", "global_config",
  "legal_acceptances", "fudo_product_map", "fudo_payment_map",
  "fudo_sync_runs", "wa_conversations", "wa_messages", "wa_campaigns",
];

// Tablas con tokens/claves: NUNCA se vuelcan. Sus valores pasan a Worker secrets
// (`wrangler secret put`), no a D1. Se rechazan aunque se pidan con --tablas.
const EXCLUIDAS = new Set(["integration_secrets"]);

// Montos numeric (pesos) → INTEGER centavos con sufijo _cents (D6).
const CENTS = { price: "price_cents", total: "total_cents", delivery_fee: "delivery_fee_cents", unit_price: "unit_price_cents",
  fee: "fee_cents", min_order: "min_order_cents", total_income: "total_income_cents" };

function toCents(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Monto inválido: ${v}`);
  return Math.round(Number((n * 100).toFixed(4)));
}

// Columnas por tipo de conversión (el resto pasa tal cual).
const BOOL = new Set([
  "is_active", "wa_marketing_opt_in", "is_anonymous", "delivered_in_app", "active",
  "ok", "human_takeover",
]);
const JSON_COLS = new Set(["fudo_payments", "snapshot", "shape", "value_json", "state", "segment"]);
const JSON_BY_TABLE = { global_config: new Set(["value"]) };
const DATE_ONLY = new Set(["shift_day", "report_date"]);

const PAGE = 1000;
const PK = {
  global_config: "key", integration_secrets: "key", fudo_payment_map: "payment_method",
  fudo_product_map: "product_id", couriers: "user_id", courier_locations: "user_id",
};

function args() {
  const a = process.argv.slice(2);
  const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  return {
    // Fuera del repo y del Desktop: en Windows los modos 0600/0700 no aplican.
    // Borrar la carpeta después de importar (contiene datos personales y pin_hash).
    out: get("--out") ?? join(process.env.LOCALAPPDATA ?? join(homedir(), ".local", "share"), "deli-gastro-d1-out"),
    tablas: (get("--tablas")?.split(",") ?? TABLAS).filter((t) => {
      if (EXCLUIDAS.has(t)) console.warn(`Se omite ${t}: contiene secretos (van a Worker secrets).`);
      return !EXCLUIDAS.has(t);
    }),
    borrar: a.includes("--borrar"),
  };
}

function env(name, required = true) {
  const v = process.env[name];
  if (required && !v) throw new Error(`Falta la variable ${name}`);
  return v;
}

/** GET paginado a PostgREST (solo lectura). */
async function exportarTabla(url, key, tabla) {
  const filas = [];
  const orden = PK[tabla] ?? "id";
  for (let desde = 0; ; desde += PAGE) {
    const res = await fetch(`${url}/rest/v1/${tabla}?select=*&order=${orden}.asc`, {
      headers: {
        apikey: key, Authorization: `Bearer ${key}`,
        Range: `${desde}-${desde + PAGE - 1}`, "Range-Unit": "items", Prefer: "count=exact",
      },
    });
    if (!res.ok && res.status !== 206) {
      throw new Error(`${tabla}: HTTP ${res.status} ${await res.text()}`);
    }
    const lote = await res.json();
    filas.push(...lote);
    if (lote.length < PAGE) break;
  }
  return filas;
}

/** Usuarios: Admin API (solo lectura). Sin hashes de contraseña (D3). */
async function exportarUsuarios(url, key) {
  const usuarios = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=1000`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`auth.users: HTTP ${res.status}`);
    const { users } = await res.json();
    usuarios.push(...users);
    if (users.length < 1000) break;
  }
  return usuarios.map((u) => ({
    id: u.id,
    name: u.user_metadata?.name ?? u.user_metadata?.full_name ?? "",
    email: u.email ?? `${u.id}@sin-email.invalid`,
    emailVerified: u.email_confirmed_at ? 1 : 0,
    role: ["admin", "cliente", "repartidor"].includes(u.app_metadata?.role) ? u.app_metadata.role : "cliente",
    banned: u.banned_until && new Date(u.banned_until) > new Date() ? 1 : 0,
    banExpires: u.banned_until ? isoUtc(u.banned_until) : null,
    createdAt: isoUtc(u.created_at),
    updatedAt: isoUtc(u.updated_at ?? u.created_at),
  }));
}

/** timestamptz → ISO UTC con ms y Z (ordenable como texto). */
function isoUtc(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`Fecha inválida: ${v}`);
  return d.toISOString();
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/;

function transformar(tabla, fila) {
  const out = {};
  for (const [col, v] of Object.entries(fila)) {
    if (v === null || v === undefined) { out[col] = null; continue; }
    if (BOOL.has(col)) out[col] = v ? 1 : 0;
    else if (JSON_COLS.has(col) || JSON_BY_TABLE[tabla]?.has(col) || typeof v === "object") out[col] = JSON.stringify(v);
    else if (DATE_ONLY.has(col)) out[col] = String(v).slice(0, 10);
    else if (typeof v === "string" && ISO_RE.test(v)) out[col] = isoUtc(v);
    else if (CENTS[col] && tabla !== "user") out[CENTS[col]] = toCents(v);
    else if (col === "points_per_100" && typeof v === "string") out[col] = Number(v);
    else out[col] = v;
  }
  if (tabla === "orders") out.courier_user_id = null; // se completa al final por nombre (G13)
  if (tabla === "payment_intents") out.version = 0;
  if (tabla === "clients") {
    const dig = (fila.phone ?? "").replace(/\D/g, "");
    out.phone_digits = dig ? dig.slice(-10) : null;
  }
  return out;
}

function literal(v) {
  if (v === null) return "NULL";
  if (typeof v === "number") { if (!Number.isFinite(v)) throw new Error(`Número inválido ${v}`); return String(v); }
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * Upsert por clave primaria. NO se usa INSERT OR REPLACE: en SQLite el REPLACE
 * borra la fila vieja y dispara los ON DELETE CASCADE (borraría order_items, etc.).
 */
function insertSql(tabla, filas) {
  const pk = PK[tabla] ?? "id";
  const nombre = tabla === "user" ? '"user"' : tabla;
  return filas.map((f) => {
    const cols = Object.keys(f);
    const set = cols.filter((c) => c !== pk).map((c) => `${c} = excluded.${c}`).join(", ");
    return `INSERT INTO ${nombre} (${cols.join(", ")}) VALUES (${cols.map((c) => literal(f[c])).join(", ")})` +
      (set ? ` ON CONFLICT(${pk}) DO UPDATE SET ${set};` : ` ON CONFLICT(${pk}) DO NOTHING;`);
  });
}

async function main() {
  const { out, tablas, borrar } = args();
  const url = env("SUPABASE_URL").replace(/\/$/, "");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  // La salida contiene datos personales (y pin_hash/pin_encrypted de repartidores): solo legible por el dueño.
  await mkdir(out, { recursive: true, mode: 0o700 });

  // D1 no admite BEGIN/COMMIT en archivos: `wrangler d1 execute --file` ya corre el lote.
  // Se desactivan FKs durante la carga para tolerar el orden; verificar.sql corre foreign_key_check.
  const lineas = ["PRAGMA defer_foreign_keys = on;"];
  const conteos = {};
  const puntos = new Map();

  const usuarios = await exportarUsuarios(url, key);
  conteos.user = usuarios.length;
  if (borrar) lineas.push('DELETE FROM "user";');
  lineas.push(...insertSql("user", usuarios.map((u) => transformar("user", u))));
  // El ledger se importa sin el trigger (el orden de carga podría dejar saldos
  // negativos transitorios); total_points se re-escribe desde origen al final.
  lineas.push("DROP TRIGGER IF EXISTS points_ledger_after_insert;");

  for (const tabla of tablas) {
    const filas = await exportarTabla(url, key, tabla);
    conteos[tabla] = filas.length;
    if (tabla === "clients") for (const c of filas) puntos.set(c.id, Number(c.total_points) || 0);
    if (borrar) lineas.push(`DELETE FROM ${tabla};`);
    lineas.push(...insertSql(tabla, filas.map((f) => transformar(tabla, f))));
    lineas.push(`INSERT OR REPLACE INTO _migracion (tabla, filas_origen) VALUES ('${tabla}', ${filas.length});`);
    console.log(`${tabla.padEnd(22)} ${String(filas.length).padStart(6)} filas`);
  }
  lineas.push(`INSERT OR REPLACE INTO _migracion (tabla, filas_origen) VALUES ('user', ${usuarios.length});`);
  lineas.push(
    "CREATE TRIGGER IF NOT EXISTS points_ledger_after_insert AFTER INSERT ON points_ledger BEGIN UPDATE clients SET total_points = total_points + NEW.delta WHERE id = NEW.client_id; END;",
  );
  // G15: un pedido por pago (UNIQUE orders.payment_intent_id).
  lineas.push(
    "UPDATE orders SET payment_intent_id = (SELECT p.id FROM payment_intents p WHERE p.order_id = orders.id) WHERE (SELECT count(*) FROM payment_intents p WHERE p.order_id = orders.id) = 1;",
  );
  // G13: dueño del pedido por id, derivado del nombre del repartidor (si es único).
  lineas.push(
    "UPDATE orders SET courier_user_id = (SELECT c.user_id FROM couriers c WHERE c.name = orders.courier_name) WHERE courier_name IS NOT NULL AND (SELECT count(*) FROM couriers c WHERE c.name = orders.courier_name) = 1;",
  );

  // El trigger points_ledger_after_insert suma deltas al importar el ledger, pero
  // clients.total_points ya viene calculado de origen: se re-escribe al final.
  if (puntos.size) {
    for (const [id, pts] of puntos) lineas.push(`UPDATE clients SET total_points = ${pts} WHERE id = ${literal(id)};`);
  }

  const verificar = [
    ...Object.keys(conteos).map(
      (t) => `SELECT '${t}' AS tabla, (SELECT count(*) FROM "${t}") AS d1, ${conteos[t]} AS origen, (SELECT count(*) FROM "${t}") = ${conteos[t]} AS ok;`,
    ),
    "PRAGMA foreign_key_check;",
    "SELECT 'puntos_inconsistentes' AS chequeo, count(*) AS n FROM clients c WHERE c.total_points < 0;",
    // Condición del auditor: el saldo de cada cliente = suma de su ledger (si no, listar).
    "SELECT 'saldo_distinto_del_ledger' AS chequeo, c.id, c.total_points, COALESCE(SUM(l.delta), 0) AS suma_ledger FROM clients c LEFT JOIN points_ledger l ON l.client_id = c.id GROUP BY c.id HAVING c.total_points <> MAX(0, COALESCE(SUM(l.delta), 0));",
  ];

  const privado = { mode: 0o600 };
  await writeFile(join(out, "datos.sql"), lineas.join("\n") + "\n", privado);
  await writeFile(join(out, "verificar.sql"), verificar.join("\n") + "\n", privado);
  await writeFile(join(out, "conteos.json"), JSON.stringify({ generado: new Date().toISOString(), conteos }, null, 2), privado);
  console.log(`\nListo: ${join(out, "datos.sql")} (${lineas.length} sentencias). Verificar con verificar.sql.`);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
