/**
 * Reclamos de clientes (tablas `reclamos` y `reclamos_eventos`, migraciones 0014 y 0016).
 * El Worker del bot crea y actualiza los tickets; acá el panel los lista, los toma, agrega notas,
 * registra los mensajes al cliente y los resuelve con una compensación (puntos o descuento).
 */
import { z } from "zod";
import { esConsulta } from "../reclamos/categoria.ts";
import { requireStaff, type Actor } from "./actor.ts";
import { addPointsStatement } from "./points.ts";
import { nowIso, type SqlDatabase, type SqlStatement } from "./sql.ts";

export const RECLAMO_CATEGORIAS = ["demora", "llego_frio", "faltante", "pedido_equivocado", "cobro", "atencion", "otro"] as const;
export const RECLAMO_ESTADOS = ["abierto", "en_curso", "resuelto"] as const;
export type ReclamoCategoria = (typeof RECLAMO_CATEGORIAS)[number];
export type ReclamoEstadoValor = (typeof RECLAMO_ESTADOS)[number];
export type CompensacionTipo = "puntos" | "descuento";

export interface Reclamo {
  id: string;
  numero: number;
  conversation_id: string;
  client_phone: string;
  client_id: string | null;
  client_name: string | null;
  order_id: string | null;
  categoria: ReclamoCategoria;
  motivo: string;
  foto_keys: string[];
  estado: ReclamoEstadoValor;
  resolucion: string | null;
  compensacion_tipo: CompensacionTipo | null;
  compensacion_valor: number | null;
  notas: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  notified_at: string | null;
  /** Sugerencia del agente de reclamos (JSON ya validado al guardarla); null = sin sugerencia. */
  sugerencia: unknown;
  sugerencia_at: string | null;
  sugerencia_error: string | null;
  mensaje_resolucion: string | null;
  notificacion_estado: "enviado" | "fallo" | null;
  notificacion_error: string | null;
}

export interface ReclamoEvento {
  id: string;
  tipo: "creado" | "actualizado" | "foto" | "estado" | "nota" | "mensaje" | "compensacion" | "notificado";
  detalle: string;
  autor: "bot" | "admin" | "sistema";
  created_at: string;
}

export interface ReclamoPedido {
  id: string;
  status: string;
  items_desc: string;
  total_cents: number;
  created_at: string;
}

export interface ReclamoDetalle extends Reclamo {
  eventos: ReclamoEvento[];
  pedido: ReclamoPedido | null;
}

const COLS = `r.id, r.numero, r.conversation_id, r.client_phone, r.client_id, coalesce(c.name, w.contact_name) AS client_name,
  r.order_id, r.categoria, r.motivo, r.foto_keys, r.estado, r.resolucion, r.compensacion_tipo, r.compensacion_valor, r.notas,
  r.created_at, r.updated_at, r.resolved_at, r.notified_at, r.sugerencia, r.sugerencia_at, r.sugerencia_error,
  r.mensaje_resolucion, r.notificacion_estado, r.notificacion_error
  FROM reclamos r
  LEFT JOIN clients c ON c.id = r.client_id
  LEFT JOIN wa_conversations w ON w.id = r.conversation_id`;

type Row = Omit<Reclamo, "foto_keys" | "sugerencia"> & { foto_keys: string; sugerencia: string | null };

function parseKeys(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

const fromRow = (row: Row): Reclamo => ({ ...row, foto_keys: parseKeys(row.foto_keys), sugerencia: row.sugerencia ? safeJson(row.sugerencia) ?? null : null });

/* ---------------------------------------------------------------- esquemas */

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (AAAA-MM-DD)");

export const reclamoFiltrosSchema = z
  .object({
    estado: z.enum(RECLAMO_ESTADOS).optional(),
    categoria: z.enum(RECLAMO_CATEGORIAS).optional(),
    desde: fecha.optional(),
    hasta: fecha.optional(),
  })
  .strict();
export type ReclamoFiltros = z.infer<typeof reclamoFiltrosSchema>;

/** Compatibilidad con la lista vieja de /admin/conocimiento. */
export const reclamoEstadoSchema = z.object({ id: z.string().min(1).max(64), estado: z.enum(RECLAMO_ESTADOS) }).strict();
export type ReclamoEstado = z.infer<typeof reclamoEstadoSchema>;

const texto = (max: number) => z.string().trim().min(1, "Escribí algo").max(max);

export const reclamoAccionSchema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("tomar") }).strict(),
  z.object({ accion: z.literal("reabrir") }).strict(),
  z.object({ accion: z.literal("nota"), texto: texto(1000) }).strict(),
  z.object({ accion: z.literal("responder"), texto: texto(1000) }).strict(),
  z.object({ accion: z.literal("sugerir") }).strict(),
  z.object({ accion: z.literal("renotificar") }).strict(),
  z
    .object({
      accion: z.literal("resolver"),
      resolucion: texto(1000),
      /** Mensaje (editado) que se le manda al cliente; sin él se arma uno con la resolución y la compensación. */
      mensaje: texto(1000).optional(),
      compensacion: z
        .discriminatedUnion("tipo", [
          // Hasta 10.000 puntos por reclamo: un tope que evita un cero de más por error.
          z.object({ tipo: z.literal("puntos"), valor: z.number().int().min(1).max(10_000) }).strict(),
          // Descuento en porcentaje sobre el próximo pedido.
          z.object({ tipo: z.literal("descuento"), valor: z.number().int().min(1).max(100) }).strict(),
        ])
        .nullable()
        .optional(),
    })
    .strict(),
]);
export type ReclamoAccion = z.infer<typeof reclamoAccionSchema>;

/* ---------------------------------------------------------------- lecturas */

const AR_OFFSET = "-03:00";
const dayStart = (d: string) => new Date(`${d}T00:00:00${AR_OFFSET}`).toISOString();
const dayEnd = (d: string) => new Date(new Date(`${d}T00:00:00${AR_OFFSET}`).getTime() + 86_400_000).toISOString();

/** Abiertos primero (después en curso y resueltos), los más nuevos arriba. Filtros opcionales. */
export async function listReclamos(db: SqlDatabase, actor: Actor, filtros: ReclamoFiltros = {}, limit = 100): Promise<Reclamo[]> {
  requireStaff(actor);
  const lim = Math.min(Math.max(limit, 1), 200);
  const desde = filtros.desde ? dayStart(filtros.desde) : null;
  const hasta = filtros.hasta ? dayEnd(filtros.hasta) : null;
  const { results } = await db
    .prepare(
      `SELECT ${COLS}
       WHERE (?1 IS NULL OR r.estado = ?1) AND (?2 IS NULL OR r.categoria = ?2)
         AND (?3 IS NULL OR r.created_at >= ?3) AND (?4 IS NULL OR r.created_at < ?4)
       ORDER BY CASE r.estado WHEN 'abierto' THEN 0 WHEN 'en_curso' THEN 1 ELSE 2 END, r.created_at DESC LIMIT ?5`,
    )
    .bind(filtros.estado ?? null, filtros.categoria ?? null, desde, hasta, lim)
    .all<Row>();
  return results.map(fromRow);
}

export async function getReclamo(db: SqlDatabase, actor: Actor, id: string): Promise<ReclamoDetalle | null> {
  requireStaff(actor);
  const row = await db.prepare(`SELECT ${COLS} WHERE r.id = ?`).bind(id).first<Row>();
  if (!row) return null;
  const [{ results: eventos }, pedido] = await Promise.all([
    db
      .prepare("SELECT id, tipo, detalle, autor, created_at FROM reclamos_eventos WHERE reclamo_id = ? ORDER BY created_at, rowid")
      .bind(id)
      .all<ReclamoEvento>(),
    row.order_id
      ? db.prepare("SELECT id, status, items_desc, total_cents, created_at FROM orders WHERE id = ?").bind(row.order_id).first<ReclamoPedido>()
      : Promise.resolve(null),
  ]);
  return { ...fromRow(row), eventos, pedido };
}

export interface ReclamosResumen {
  abiertos: number;
  enCurso: number;
  /** Abiertos (sin tomar) creados antes de `slaDesde`: el panel los marca como vencidos. */
  vencidos: number;
  /** Últimos abiertos (hasta 5, del más nuevo al más viejo): el panel avisa con sonido y ventana los que no vio. */
  recientes: ReclamoReciente[];
}

export interface ReclamoReciente {
  id: string;
  numero: number;
  categoria: ReclamoCategoria;
  client_name: string | null;
  created_at: string;
  /** Es una consulta sin respuesta del bot (no un reclamo): el aviso del panel lo dice así. */
  consulta: boolean;
}

/**
 * Contadores para el aviso del panel. `slaDesde` lo calcula quien llama (2 h atrás, contando solo el
 * tiempo con el local abierto); null = local cerrado, no hay vencidos.
 */
export async function resumenReclamos(db: SqlDatabase, actor: Actor, slaDesde: string | null): Promise<ReclamosResumen> {
  requireStaff(actor);
  const row = await db
    .prepare(
      `SELECT coalesce(sum(estado = 'abierto'), 0) AS abiertos, coalesce(sum(estado = 'en_curso'), 0) AS en_curso,
              coalesce(sum(estado = 'abierto' AND ?1 IS NOT NULL AND created_at < ?1), 0) AS vencidos
       FROM reclamos WHERE estado <> 'resuelto'`,
    )
    .bind(slaDesde)
    .first<{ abiertos: number; en_curso: number; vencidos: number }>();
  const { results } = await db
    .prepare(
      `SELECT r.id, r.numero, r.categoria, r.motivo, coalesce(c.name, w.contact_name) AS client_name, r.created_at
       FROM reclamos r LEFT JOIN clients c ON c.id = r.client_id LEFT JOIN wa_conversations w ON w.id = r.conversation_id
       WHERE r.estado = 'abierto' ORDER BY r.created_at DESC LIMIT 5`,
    )
    .all<Omit<ReclamoReciente, "consulta"> & { motivo: string }>();
  // El motivo (texto del cliente) no viaja al navegador en este aviso: solo si es una consulta.
  const recientes = results.map(({ motivo, ...r }): ReclamoReciente => ({ ...r, consulta: esConsulta({ motivo, categoria: r.categoria }) }));
  return { abiertos: Number(row?.abiertos ?? 0), enCurso: Number(row?.en_curso ?? 0), vencidos: Number(row?.vencidos ?? 0), recientes };
}

/** Cantidad de reclamos por categoría desde `desde` (ISO). Todas las categorías, con 0 si no hubo. */
export async function reclamosPorCategoria(db: SqlDatabase, actor: Actor, desde: string): Promise<Record<ReclamoCategoria, number>> {
  requireStaff(actor);
  const { results } = await db
    .prepare("SELECT categoria, count(*) AS n FROM reclamos WHERE created_at >= ? GROUP BY categoria")
    .bind(desde)
    .all<{ categoria: ReclamoCategoria; n: number }>();
  const out = Object.fromEntries(RECLAMO_CATEGORIAS.map((c) => [c, 0])) as Record<ReclamoCategoria, number>;
  for (const r of results) if (r.categoria in out) out[r.categoria] = Number(r.n);
  return out;
}

/* ---------------------------------------------------------------- escrituras */

function eventoStmt(db: SqlDatabase, reclamoId: string, tipo: ReclamoEvento["tipo"], detalle: string, autor: ReclamoEvento["autor"]): SqlStatement {
  return db
    .prepare("INSERT INTO reclamos_eventos (id, reclamo_id, tipo, detalle, autor, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), reclamoId, tipo, detalle.slice(0, 2000), autor, nowIso());
}

/** Lista vieja: marcar abierto/en curso/resuelto sin más datos. false si no existe. */
export async function setReclamoEstado(db: SqlDatabase, actor: Actor, input: ReclamoEstado): Promise<boolean> {
  requireStaff(actor);
  const now = nowIso();
  const [r] = await db.batch([
    db
      .prepare("UPDATE reclamos SET estado = ?, resolved_at = ?, updated_at = ? WHERE id = ?")
      .bind(input.estado, input.estado === "resuelto" ? now : null, now, input.id),
    db
      .prepare("INSERT INTO reclamos_eventos (id, reclamo_id, tipo, detalle, autor, created_at) SELECT ?, id, 'estado', ?, 'admin', ? FROM reclamos WHERE id = ?")
      .bind(crypto.randomUUID(), `Estado: ${input.estado}`, now, input.id),
  ]);
  return r.meta.changes === 1;
}

export class ReclamoNoEncontradoError extends Error {
  constructor() {
    super("No se encontró el reclamo.");
    this.name = "ReclamoNoEncontradoError";
  }
}

export class ReclamoConflictoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReclamoConflictoError";
  }
}

/** Toma el reclamo (abierto → en curso) o lo reabre (resuelto → abierto). */
export async function cambiarEstadoReclamo(db: SqlDatabase, actor: Actor, id: string, accion: "tomar" | "reabrir"): Promise<void> {
  requireStaff(actor);
  const now = nowIso();
  const [desde, hacia] = accion === "tomar" ? ["abierto", "en_curso"] : ["resuelto", "abierto"];
  const [r] = await db.batch([
    db
      .prepare("UPDATE reclamos SET estado = ?, updated_at = ?, resolved_at = CASE WHEN ? = 'abierto' THEN NULL ELSE resolved_at END WHERE id = ? AND estado = ?")
      .bind(hacia, now, hacia, id, desde),
    db
      .prepare("INSERT INTO reclamos_eventos (id, reclamo_id, tipo, detalle, autor, created_at) SELECT ?, id, 'estado', ?, 'admin', ? FROM reclamos WHERE id = ? AND changes() = 1")
      .bind(crypto.randomUUID(), accion === "tomar" ? "Tomado por el local (en curso)" : "Reabierto", now, id),
  ]);
  if (r.meta.changes === 0) {
    const existe = await db.prepare("SELECT estado FROM reclamos WHERE id = ?").bind(id).first<{ estado: string }>();
    if (!existe) throw new ReclamoNoEncontradoError();
    throw new ReclamoConflictoError(accion === "tomar" ? "El reclamo ya no está abierto." : "El reclamo no está resuelto.");
  }
}

/** Nota interna: se suma a `notas` y queda en el historial. */
export async function agregarNotaReclamo(db: SqlDatabase, actor: Actor, id: string, texto: string): Promise<void> {
  requireStaff(actor);
  const now = nowIso();
  const [r] = await db.batch([
    db
      .prepare("UPDATE reclamos SET notas = substr(CASE WHEN notas IS NULL OR notas = '' THEN ? ELSE notas || char(10) || ? END, 1, 4000), updated_at = ? WHERE id = ?")
      .bind(texto, texto, now, id),
    db
      .prepare("INSERT INTO reclamos_eventos (id, reclamo_id, tipo, detalle, autor, created_at) SELECT ?, id, 'nota', ?, 'admin', ? FROM reclamos WHERE id = ?")
      .bind(crypto.randomUUID(), texto, now, id),
  ]);
  if (r.meta.changes === 0) throw new ReclamoNoEncontradoError();
}

/** Registra un mensaje de WhatsApp ya enviado al cliente (historial + wa_messages para el panel de conversaciones). */
export async function registrarMensajeReclamo(
  db: SqlDatabase,
  actor: Actor,
  input: { id: string; conversationId: string; wamid: string; texto: string },
): Promise<void> {
  requireStaff(actor);
  const now = nowIso();
  await db.batch([
    eventoStmt(db, input.id, "mensaje", input.texto, "admin"),
    db
      .prepare("INSERT INTO wa_messages (id, conversation_id, wamid, direction, type, body, created_at) VALUES (?, ?, ?, 'out', 'text', ?, ?) ON CONFLICT (wamid) DO NOTHING")
      .bind(crypto.randomUUID(), input.conversationId, input.wamid, input.texto, now),
    db.prepare("UPDATE reclamos SET updated_at = ? WHERE id = ?").bind(now, input.id),
  ]);
}

export interface ResolucionResultado {
  reclamo: Reclamo;
  /** Puntos acreditados ahora (0 si no hubo o ya se habían acreditado). */
  puntosAcreditados: number;
}

/**
 * Resuelve el reclamo. Con compensación en PUNTOS se acredita en el ledger del cliente (idempotente por
 * `reclamo:<id>`, en el mismo batch: o queda todo o nada). El DESCUENTO solo se registra en el reclamo
 * (no hay sistema de cupones todavía): el local lo aplica a mano en el próximo pedido.
 */
export async function resolverReclamo(
  db: SqlDatabase,
  actor: Actor,
  id: string,
  input: { resolucion: string; compensacion?: { tipo: CompensacionTipo; valor: number } | null; mensaje?: string },
): Promise<ResolucionResultado> {
  requireStaff(actor);
  const actual = await db.prepare(`SELECT ${COLS} WHERE r.id = ?`).bind(id).first<Row>();
  if (!actual) throw new ReclamoNoEncontradoError();
  if (actual.estado === "resuelto") throw new ReclamoConflictoError("El reclamo ya está resuelto.");
  const comp = input.compensacion ?? null;
  if (comp?.tipo === "puntos" && !actual.client_id) {
    throw new ReclamoConflictoError("El reclamo no tiene un cliente registrado: no se pueden sumar puntos.");
  }

  const now = nowIso();
  const stmts: SqlStatement[] = [
    db
      .prepare(
        `UPDATE reclamos SET estado = 'resuelto', resolucion = ?, compensacion_tipo = ?, compensacion_valor = ?, resolved_at = ?, updated_at = ?,
           mensaje_resolucion = ?, notificacion_estado = NULL, notificacion_error = NULL
         WHERE id = ? AND estado <> 'resuelto'`,
      )
      .bind(input.resolucion, comp?.tipo ?? null, comp?.valor ?? null, now, now, input.mensaje ?? null, id),
    eventoStmt(db, id, "estado", `Resuelto: ${input.resolucion}`, "admin"),
  ];
  if (comp) {
    const detalle = comp.tipo === "puntos" ? `${comp.valor} puntos acreditados` : `${comp.valor}% de descuento en el próximo pedido (aplicarlo a mano)`;
    stmts.push(eventoStmt(db, id, "compensacion", detalle, "admin"));
  }
  if (comp?.tipo === "puntos" && actual.client_id) {
    stmts.push(
      addPointsStatement(db, actor, {
        id: crypto.randomUUID(),
        clientId: actual.client_id,
        delta: comp.valor,
        description: `Compensación por reclamo #${actual.numero}`,
        orderId: actual.order_id,
        idempotencyKey: `reclamo:${id}`,
      }),
    );
  }
  const results = await db.batch(stmts);
  if (results[0].meta.changes === 0) throw new ReclamoConflictoError("El reclamo ya está resuelto.");
  const puntosAcreditados = comp?.tipo === "puntos" ? (results.at(-1)?.meta.changes === 1 ? comp.valor : 0) : 0;
  const reclamo = fromRow({
    ...actual,
    estado: "resuelto",
    resolucion: input.resolucion,
    compensacion_tipo: comp?.tipo ?? null,
    compensacion_valor: comp?.valor ?? null,
    resolved_at: now,
    updated_at: now,
    mensaje_resolucion: input.mensaje ?? null,
  });
  return { reclamo, puntosAcreditados };
}

/* ---------------------------------------------------------------- aviso al local */

export interface ReclamoAvisoContexto {
  reclamo: Reclamo;
  pedido: ReclamoPedido | null;
  /** Mails de los destinatarios activos del resumen diario (Configuración → Notificaciones). */
  destinatarios: string[];
  emailFrom: string | undefined;
  businessName: string;
}

/** Todo lo que hace falta para avisar por mail de un reclamo nuevo; null si no existe. */
export async function contextoAvisoReclamo(db: SqlDatabase, actor: Actor, id: string): Promise<ReclamoAvisoContexto | null> {
  requireStaff(actor);
  const detalle = await getReclamo(db, actor, id);
  if (!detalle) return null;
  const { results } = await db
    .prepare("SELECT key, value FROM global_config WHERE key IN ('resumen_diario', 'notif_email_from', 'negocio_nombre')")
    .all<{ key: string; value: string }>();
  const cfg = new Map(results.map((r) => [r.key, safeJson(r.value)]));
  const text = (k: string) => (typeof cfg.get(k) === "string" ? (cfg.get(k) as string) : undefined);
  const resumen = cfg.get("resumen_diario") as { destinatarios?: unknown } | undefined;
  const destinatarios = Array.isArray(resumen?.destinatarios)
    ? resumen.destinatarios
        .filter((d): d is { email: string; activo: boolean } => typeof d === "object" && d !== null && (d as { activo?: unknown }).activo === true)
        .map((d) => (typeof d.email === "string" ? d.email.trim() : ""))
        .filter((e) => z.email().safeParse(e).success)
    : [];
  const { pedido } = detalle;
  const reclamo: Reclamo = { ...detalle };
  return { reclamo, pedido, destinatarios: [...new Set(destinatarios)], emailFrom: text("notif_email_from"), businessName: text("negocio_nombre")?.trim() || "Tu local" };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Marca el aviso como enviado (solo la primera vez) y deja el evento. false si ya estaba avisado. */
export async function marcarReclamoNotificado(db: SqlDatabase, actor: Actor, id: string, detalle: string): Promise<boolean> {
  requireStaff(actor);
  const now = nowIso();
  const [r] = await db.batch([
    db.prepare("UPDATE reclamos SET notified_at = ? WHERE id = ? AND notified_at IS NULL").bind(now, id),
    db
      .prepare("INSERT INTO reclamos_eventos (id, reclamo_id, tipo, detalle, autor, created_at) SELECT ?, id, 'notificado', ?, 'sistema', ? FROM reclamos WHERE id = ? AND changes() = 1")
      .bind(crypto.randomUUID(), detalle, now, id),
  ]);
  return r.meta.changes === 1;
}

/** Ventana de 24 h de WhatsApp: teléfono y último entrante de la conversación del reclamo. */
export async function conversacionDeReclamo(
  db: SqlDatabase,
  actor: Actor,
  id: string,
): Promise<{ conversationId: string; phone: string; lastInboundAt: string | null; numero: number } | null> {
  requireStaff(actor);
  const row = await db
    .prepare(
      `SELECT r.conversation_id, coalesce(w.client_phone, r.client_phone) AS phone, w.last_inbound_at, r.numero
       FROM reclamos r LEFT JOIN wa_conversations w ON w.id = r.conversation_id WHERE r.id = ?`,
    )
    .bind(id)
    .first<{ conversation_id: string; phone: string; last_inbound_at: string | null; numero: number }>();
  return row ? { conversationId: row.conversation_id, phone: row.phone, lastInboundAt: row.last_inbound_at, numero: row.numero } : null;
}

export interface ConfigReclamos {
  open: string;
  close: string;
  paused: boolean;
  /** `bot_modo_entrenamiento`: los reclamos no se derivan a una persona. */
  entrenamiento: boolean;
  /** Topes del agente de reclamos (`reclamo_max_puntos`, `reclamo_max_descuento_pct`). */
  maxPuntos: number;
  maxDescuentoPct: number;
}

const DEFAULT_MAX_PUNTOS = 500;
const DEFAULT_MAX_DESCUENTO_PCT = 20;

/** Horario (mismas claves que el bot) para el SLA, modo entrenamiento y topes de compensación del agente. */
export async function configReclamos(db: SqlDatabase, actor: Actor): Promise<ConfigReclamos> {
  requireStaff(actor);
  const { results } = await db
    .prepare(
      `SELECT key, value FROM global_config
       WHERE key IN ('horario_apertura', 'horario_cierre', 'modo_pausa', 'bot_modo_entrenamiento', 'reclamo_max_puntos', 'reclamo_max_descuento_pct')`,
    )
    .all<{ key: string; value: string }>();
  const cfg = new Map(results.map((r) => [r.key, safeJson(r.value)]));
  const hhmm = (k: string, d: string) => (typeof cfg.get(k) === "string" ? (cfg.get(k) as string).slice(0, 5) : d);
  const entero = (k: string, d: number, max: number) => {
    const n = Number(cfg.get(k));
    return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : d;
  };
  const training = cfg.get("bot_modo_entrenamiento");
  return {
    open: hhmm("horario_apertura", "11:00"),
    close: hhmm("horario_cierre", "23:00"),
    paused: cfg.get("modo_pausa") === true,
    entrenamiento: training === true || training === "true",
    maxPuntos: entero("reclamo_max_puntos", DEFAULT_MAX_PUNTOS, 10_000),
    maxDescuentoPct: entero("reclamo_max_descuento_pct", DEFAULT_MAX_DESCUENTO_PCT, 100),
  };
}

export interface ContextoAgenteDatos {
  reclamo: Reclamo;
  pedido: (ReclamoPedido & { delivered_at: string | null }) | null;
  pedidosCliente: number;
  ultimosPedidos: { status: string; total_cents: number; created_at: string }[];
  reclamosPrevios: { numero: number; categoria: string; estado: string; compensacion_tipo: string | null; compensacion_valor: number | null }[];
  config: ConfigReclamos;
}

/** Datos para el agente de reclamos: ticket, pedido con hora de entrega, historial del cliente (mismo teléfono) y topes. */
export async function contextoAgente(db: SqlDatabase, actor: Actor, id: string): Promise<ContextoAgenteDatos | null> {
  requireStaff(actor);
  const row = await db.prepare(`SELECT ${COLS} WHERE r.id = ?`).bind(id).first<Row>();
  if (!row) return null;
  const tail = row.client_phone.replace(/\D/g, "").slice(-10);
  const [pedido, cuenta, ultimos, previos, config] = await Promise.all([
    row.order_id
      ? db
          .prepare("SELECT id, status, items_desc, total_cents, created_at, delivered_at FROM orders WHERE id = ?")
          .bind(row.order_id)
          .first<ReclamoPedido & { delivered_at: string | null }>()
      : Promise.resolve(null),
    db
      .prepare("SELECT count(*) AS n FROM orders WHERE client_id IN (SELECT id FROM clients WHERE phone_digits = ? AND is_anonymous = 0)")
      .bind(tail)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT status, total_cents, created_at FROM orders WHERE client_id IN (SELECT id FROM clients WHERE phone_digits = ? AND is_anonymous = 0)
         ORDER BY created_at DESC LIMIT 5`,
      )
      .bind(tail)
      .all<{ status: string; total_cents: number; created_at: string }>(),
    db
      .prepare(
        `SELECT numero, categoria, estado, compensacion_tipo, compensacion_valor FROM reclamos
         WHERE substr(client_phone, -10) = ? AND id <> ? ORDER BY created_at DESC LIMIT 5`,
      )
      .bind(tail, id)
      .all<ContextoAgenteDatos["reclamosPrevios"][number]>(),
    configReclamos(db, actor),
  ]);
  return {
    reclamo: fromRow(row),
    pedido: pedido ?? null,
    pedidosCliente: Number(cuenta?.n ?? 0),
    ultimosPedidos: ultimos.results,
    reclamosPrevios: previos.results,
    config,
  };
}

/** Guarda la sugerencia del agente (JSON ya validado) o el error del último intento. */
export async function guardarSugerencia(db: SqlDatabase, actor: Actor, id: string, resultado: { sugerencia: unknown } | { error: string }): Promise<void> {
  requireStaff(actor);
  const now = nowIso();
  if ("sugerencia" in resultado) {
    await db
      .prepare("UPDATE reclamos SET sugerencia = ?, sugerencia_at = ?, sugerencia_error = NULL WHERE id = ?")
      .bind(JSON.stringify(resultado.sugerencia), now, id)
      .run();
    return;
  }
  await db.prepare("UPDATE reclamos SET sugerencia_error = ?, sugerencia_at = ? WHERE id = ?").bind(resultado.error.slice(0, 300), now, id).run();
}

/** Resultado del aviso de resolución al cliente (enviado o falló, con el motivo) y su evento. */
export async function marcarNotificacionResolucion(db: SqlDatabase, actor: Actor, id: string, ok: boolean, error?: string): Promise<void> {
  requireStaff(actor);
  const now = nowIso();
  await db.batch([
    db
      .prepare("UPDATE reclamos SET notificacion_estado = ?, notificacion_error = ?, updated_at = ? WHERE id = ?")
      .bind(ok ? "enviado" : "fallo", ok ? null : (error ?? "Error desconocido").slice(0, 300), now, id),
    ...(ok ? [] : [eventoStmt(db, id, "mensaje", `No se pudo notificar al cliente: ${error ?? "error desconocido"}`, "sistema")]),
  ]);
}

/* ---------------------------------------------------------------- app */

export const reclamosApp = {
  list: async (actor: Actor, filtros: ReclamoFiltros = {}): Promise<Reclamo[]> => listReclamos(await appDb(), actor, filtros),
  get: async (actor: Actor, id: string) => getReclamo(await appDb(), actor, id),
  resumen: async (actor: Actor, slaDesde: string | null) => resumenReclamos(await appDb(), actor, slaDesde),
  porCategoria: async (actor: Actor, desde: string) => reclamosPorCategoria(await appDb(), actor, desde),
  setEstado: async (actor: Actor, input: ReclamoEstado): Promise<boolean> => setReclamoEstado(await appDb(), actor, input),
  cambiarEstado: async (actor: Actor, id: string, accion: "tomar" | "reabrir") => cambiarEstadoReclamo(await appDb(), actor, id, accion),
  nota: async (actor: Actor, id: string, texto: string) => agregarNotaReclamo(await appDb(), actor, id, texto),
  registrarMensaje: async (actor: Actor, input: Parameters<typeof registrarMensajeReclamo>[2]) => registrarMensajeReclamo(await appDb(), actor, input),
  resolver: async (actor: Actor, id: string, input: Parameters<typeof resolverReclamo>[3]) => resolverReclamo(await appDb(), actor, id, input),
  contextoAviso: async (actor: Actor, id: string) => contextoAvisoReclamo(await appDb(), actor, id),
  marcarNotificado: async (actor: Actor, id: string, detalle: string) => marcarReclamoNotificado(await appDb(), actor, id, detalle),
  conversacion: async (actor: Actor, id: string) => conversacionDeReclamo(await appDb(), actor, id),
  config: async (actor: Actor) => configReclamos(await appDb(), actor),
  contextoAgente: async (actor: Actor, id: string) => contextoAgente(await appDb(), actor, id),
  guardarSugerencia: async (actor: Actor, id: string, r: Parameters<typeof guardarSugerencia>[3]) => guardarSugerencia(await appDb(), actor, id, r),
  marcarNotificacion: async (actor: Actor, id: string, ok: boolean, error?: string) => marcarNotificacionResolucion(await appDb(), actor, id, ok, error),
};

async function appDb(): Promise<SqlDatabase> {
  const { getDb } = await import("./db.ts");
  return getDb();
}
