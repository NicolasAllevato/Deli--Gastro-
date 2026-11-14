#!/usr/bin/env node
/**
 * Copia de usuarios Supabase Auth → tabla "user" de Better Auth en D1 (corte, decisión del usuario).
 *
 * MODO PRUEBA POR DEFECTO: solo lee de Supabase (Admin API y PostgREST, GET) y muestra un resumen
 * (conteo por rol, vínculos con clients y couriers, avisos). No escribe en ningún lado.
 *   --generar   además escribe usuarios.sql y verificar-usuarios.sql para aplicar con
 *               `wrangler d1 execute deli-gastro --remote --file …` (paso manual, con OK del usuario).
 *   --out DIR   carpeta de salida (por defecto %LOCALAPPDATA%\deli-gastro-d1-out, fuera del repo).
 *
 * Seguridad:
 * - No copia contraseñas (D3): cada usuario entra la primera vez con "olvidé mi contraseña" o link mágico.
 * - El rol sale solo de app_metadata.role (G18) y solo admin, cliente o repartidor; cualquier otro valor
 *   (por ejemplo "staff", que la app no tiene) queda como cliente y se avisa en el resumen.
 * - Nunca imprime emails ni teléfonos completos (se enmascaran). El SQL generado sí los lleva: borrar la
 *   carpeta de salida después de aplicarlo.
 * - Idempotente: upsert por id (re-correrlo actualiza, no duplica). No toca account ni session.
 *
 * Uso:
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/copiar-usuarios-d1.mjs [--generar] [--out DIR]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { authUserRow, AUTH_ROLES, USER_COLS } from "../src/lib/data/mirror.ts";

const PAGE = 1000;

/** "ana.perez@gmail.com" → "a***@g***.com" */
export function maskEmail(email) {
  if (!email || !email.includes("@")) return "(sin email)";
  const [local, domain] = email.split("@");
  const parts = domain.split(".");
  const tld = parts.length > 1 ? `.${parts.at(-1)}` : "";
  return `${local[0] ?? ""}***@${parts[0]?.[0] ?? ""}***${tld}`;
}

function literal(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("número inválido");
    return String(v);
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Sentencias idempotentes para la tabla "user" (sin contraseñas). */
export function userSql(users, now = new Date()) {
  return users.map((u) => {
    const row = authUserRow(u, now);
    const cols = [...USER_COLS];
    const updates = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ");
    return `INSERT INTO "user" (${cols.join(", ")}) VALUES (${cols.map((c) => literal(row[c])).join(", ")}) ON CONFLICT (id) DO UPDATE SET ${updates};`;
  });
}

/** Resumen sin datos personales: conteo por rol, vínculos y avisos (emails enmascarados). */
export function summarize(users, clientUserIds, courierUserIds) {
  const porRol = { admin: 0, cliente: 0, repartidor: 0 };
  const avisos = [];
  let conCliente = 0;
  let conRepartidor = 0;
  for (const u of users) {
    const raw = u.app_metadata?.role;
    const row = authUserRow(u);
    porRol[row.role] += 1;
    if (raw !== undefined && raw !== null && !AUTH_ROLES.has(raw)) {
      avisos.push(`rol desconocido "${String(raw).slice(0, 20)}" → cliente: ${maskEmail(u.email)}`);
    }
    if (clientUserIds.has(u.id)) conCliente += 1;
    if (courierUserIds.has(u.id)) {
      conRepartidor += 1;
      if (row.role !== "repartidor") avisos.push(`tiene ficha de repartidor pero rol ${row.role}: ${maskEmail(u.email)}`);
    } else if (row.role === "repartidor") {
      avisos.push(`rol repartidor sin ficha en couriers: ${maskEmail(u.email)}`);
    }
  }
  const ids = new Set(users.map((u) => u.id));
  const huerfanos = {
    clients: [...clientUserIds].filter((id) => !ids.has(id)).length,
    couriers: [...courierUserIds].filter((id) => !ids.has(id)).length,
  };
  return { total: users.length, porRol, conCliente, conRepartidor, huerfanos, avisos };
}

/** Chequeos para correr en D1 después de aplicar usuarios.sql (y la copia de datos). */
export function verifySql(summary) {
  return [
    ...Object.entries(summary.porRol).map(
      ([rol, n]) => `SELECT 'rol:${rol}' AS chequeo, (SELECT count(*) FROM "user" WHERE role = '${rol}') AS d1, ${n} AS origen;`,
    ),
    `SELECT 'clients_sin_usuario' AS chequeo, count(*) AS n FROM clients c WHERE c.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "user" u WHERE u.id = c.user_id);`,
    `SELECT 'couriers_sin_usuario' AS chequeo, count(*) AS n FROM couriers c WHERE NOT EXISTS (SELECT 1 FROM "user" u WHERE u.id = c.user_id);`,
    `SELECT 'couriers_con_rol_distinto' AS chequeo, count(*) AS n FROM couriers c JOIN "user" u ON u.id = c.user_id WHERE u.role <> 'repartidor';`,
    `SELECT 'cuentas_con_password' AS chequeo, count(*) AS n FROM "account" WHERE password IS NOT NULL;`,
  ];
}

function env(name) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Falta la variable ${name}`);
  return v;
}

async function fetchJson(url, key) {
  const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${new URL(url).pathname}`);
  return res.json();
}

async function main() {
  const argv = process.argv.slice(2);
  const generar = argv.includes("--generar");
  const outIdx = argv.indexOf("--out");
  const out = outIdx >= 0 ? argv[outIdx + 1] : join(process.env.LOCALAPPDATA ?? join(homedir(), ".local", "share"), "deli-gastro-d1-out");
  const url = env("SUPABASE_URL").replace(/\/$/, "");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");

  const users = [];
  for (let page = 1; ; page++) {
    const { users: lote } = await fetchJson(`${url}/auth/v1/admin/users?page=${page}&per_page=${PAGE}`, key);
    users.push(...lote);
    if (lote.length < PAGE) break;
  }
  const clients = await fetchJson(`${url}/rest/v1/clients?select=user_id&user_id=not.is.null`, key);
  const couriers = await fetchJson(`${url}/rest/v1/couriers?select=user_id`, key);
  const summary = summarize(users, new Set(clients.map((c) => c.user_id)), new Set(couriers.map((c) => c.user_id)));

  console.log(generar ? "Modo: GENERAR SQL (no escribe en D1)" : "Modo: PRUEBA (solo lectura, no escribe nada)");
  console.log(`Usuarios: ${summary.total}`);
  for (const [rol, n] of Object.entries(summary.porRol)) console.log(`  ${rol.padEnd(11)} ${n}`);
  console.log(`Con ficha de cliente: ${summary.conCliente} · con ficha de repartidor: ${summary.conRepartidor}`);
  console.log(`Fichas sin usuario: clients ${summary.huerfanos.clients} · couriers ${summary.huerfanos.couriers}`);
  for (const aviso of summary.avisos) console.log(`  AVISO: ${aviso}`);
  console.log("Contraseñas: no se copian (D3). Primer ingreso con \"olvidé mi contraseña\" o link mágico.");

  if (!generar) return;
  await mkdir(out, { recursive: true, mode: 0o700 });
  const privado = { mode: 0o600 };
  await writeFile(join(out, "usuarios.sql"), userSql(users).join("\n") + "\n", privado);
  await writeFile(join(out, "verificar-usuarios.sql"), verifySql(summary).join("\n") + "\n", privado);
  console.log(`\nListo en ${out}: usuarios.sql y verificar-usuarios.sql. Borrar la carpeta después de aplicarlos.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
