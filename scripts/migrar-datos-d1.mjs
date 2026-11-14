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
import { fileURLToPath } from "node:url";
import { authUserRow } from "../src/lib/data/mirror.ts";

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
  "ok", "human_takeover", "is_combo",
]);
const JSON_COLS = new Set(["fudo_payments", "fudo_options", "snapshot", "shape", "value_json", "state", "segment"]);
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
      // Solo tablas de la app: nunca las del sistema de recetas/insumos que comparte la base.
      if (!TABLAS.includes(t)) throw new Error(`Tabla fuera de la app, no se copia: ${t}`);
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
  return usuarios;
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

/**
 * Arma el SQL de la copia completa a partir de lo exportado de Supabase (sin red ni disco: testeable).
 * Devuelve las sentencias de carga, las de verificación y los conteos y sumas de control de origen.
 */
export function construir(usuarios, filasPorTabla, { borrar = false } = {}) {
  // D1 no admite BEGIN/COMMIT en archivos: `wrangler d1 execute --file` ya corre el lote.
  // Se desactivan FKs durante la carga para tolerar el orden; verificar.sql corre foreign_key_check.
  const lineas = ["PRAGMA defer_foreign_keys = on;"];
  const conteos = {};
  /** Sumas de control en origen: montos en centavos y deltas de puntos (tabla.columna → valor). */
  const sumas = {};
  const puntos = new Map();

  conteos.user = usuarios.length;
  if (borrar) lineas.push('DELETE FROM "user";');
  lineas.push(...insertSql("user", usuarios.map((u) => authUserRow(u))));
  // El ledger se importa sin el trigger (el orden de carga podría dejar saldos
  // negativos transitorios); total_points se re-escribe desde origen al final.
  lineas.push("DROP TRIGGER IF EXISTS points_ledger_after_insert;");

  for (const [tabla, filas] of filasPorTabla) {
    conteos[tabla] = filas.length;
    if (tabla === "clients") for (const c of filas) puntos.set(c.id, Number(c.total_points) || 0);
    for (const [col, d1col] of Object.entries(CENTS)) {
      if (filas.some((f) => f[col] !== undefined)) {
        sumas[`${tabla}.${d1col}`] = filas.reduce((acc, f) => acc + (f[col] == null ? 0 : toCents(f[col])), 0);
      }
    }
    if (tabla === "points_ledger") sumas["points_ledger.delta"] = filas.reduce((acc, f) => acc + Number(f.delta || 0), 0);
    if (tabla === "clients") sumas["clients.total_points"] = filas.reduce((acc, f) => acc + Number(f.total_points || 0), 0);
    if (borrar) lineas.push(`DELETE FROM ${tabla};`);
    lineas.push(...insertSql(tabla, filas.map((f) => transformar(tabla, f))));
    lineas.push(`INSERT OR REPLACE INTO _migracion (tabla, filas_origen) VALUES ('${tabla}', ${filas.length});`);
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
  // El trigger suma deltas al importar el ledger, pero clients.total_points ya viene calculado de origen.
  for (const [id, pts] of puntos) lineas.push(`UPDATE clients SET total_points = ${pts} WHERE id = ${literal(id)};`);

  const verificar = [
    ...Object.keys(conteos).map(
      (t) => `SELECT '${t}' AS tabla, (SELECT count(*) FROM "${t}") AS d1, ${conteos[t]} AS origen, (SELECT count(*) FROM "${t}") = ${conteos[t]} AS ok;`,
    ),
    // Sumas por tabla: montos (centavos) y puntos tienen que coincidir exactamente con origen.
    ...Object.entries(sumas).map(([clave, origen]) => {
      const [t, c] = clave.split(".");
      return `SELECT 'suma:${clave}' AS chequeo, (SELECT COALESCE(SUM(${c}), 0) FROM "${t}") AS d1, ${origen} AS origen, (SELECT COALESCE(SUM(${c}), 0) FROM "${t}") = ${origen} AS ok;`;
    }),
    "PRAGMA foreign_key_check;",
    "SELECT 'puntos_inconsistentes' AS chequeo, count(*) AS n FROM clients c WHERE c.total_points < 0;",
    // Condición del auditor: el saldo de cada cliente = suma de su ledger (si no, listar).
    "SELECT 'saldo_distinto_del_ledger' AS chequeo, c.id, c.total_points, COALESCE(SUM(l.delta), 0) AS suma_ledger FROM clients c LEFT JOIN points_ledger l ON l.client_id = c.id GROUP BY c.id HAVING c.total_points <> MAX(0, COALESCE(SUM(l.delta), 0));",
    // Ningún usuario copiado tiene contraseña (D3): entran con "olvidé mi contraseña".
    `SELECT 'cuentas_con_password' AS chequeo, count(*) AS n FROM "account" WHERE password IS NOT NULL;`,
  ];
  return { lineas, verificar, conteos, sumas };
}

async function main() {
  const { out, tablas, borrar } = args();
  const url = env("SUPABASE_URL").replace(/\/$/, "");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  // La salida contiene datos personales (y pin_hash/pin_encrypted de repartidores): solo legible por el dueño.
  await mkdir(out, { recursive: true, mode: 0o700 });

  const usuarios = await exportarUsuarios(url, key);
  const filasPorTabla = [];
  for (const tabla of tablas) {
    const filas = await exportarTabla(url, key, tabla);
    filasPorTabla.push([tabla, filas]);
    console.log(`${tabla.padEnd(22)} ${String(filas.length).padStart(6)} filas`);
  }
  const { lineas, verificar, conteos, sumas } = construir(usuarios, filasPorTabla, { borrar });

  const privado = { mode: 0o600 };
  await writeFile(join(out, "datos.sql"), lineas.join("\n") + "\n", privado);
  await writeFile(join(out, "verificar.sql"), verificar.join("\n") + "\n", privado);
  await writeFile(join(out, "conteos.json"), JSON.stringify({ generado: new Date().toISOString(), conteos, sumas }, null, 2), privado);
  console.log(`\nListo: ${join(out, "datos.sql")} (${lineas.length} sentencias). Verificar con verificar.sql. Borrar la carpeta después de importar.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}

