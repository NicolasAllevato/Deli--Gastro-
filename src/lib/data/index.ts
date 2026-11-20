/**
 * Punto de entrada público de la capa de datos D1. Las rutas usan SOLO esto:
 *
 *   const data = await dataFor(actor);
 *   const pedidos = await data.orders.list();
 *
 * El actor queda fijado al crear el objeto y el handle de la base nunca sale
 * de la capa. Importar ./db o ./sql desde afuera está prohibido (ESLint +
 * tests/data-guard.test.ts).
 */
import type { Actor } from "./actor.ts";
import { getDb } from "./db.ts";
import type { SqlDatabase } from "./sql.ts";
import * as clients from "./clients.ts";
import * as orders from "./orders.ts";
import * as points from "./points.ts";
import * as reviews from "./reviews.ts";
import * as legal from "./legal.ts";
import * as catalog from "./catalog.ts";
import * as catalogAdmin from "./catalog-admin.ts";
import * as clientViews from "./client-views.ts";
import * as payments from "./payments.ts";
import * as couriers from "./couriers.ts";
import * as pins from "./pin-attempts.ts";
import * as restricted from "./restricted.ts";
import * as mirror from "./mirror.ts";
import * as live from "./live.ts";
import * as session from "./session.ts";
import * as fudoSales from "./fudo-sales.ts";
import * as zones from "./zones.ts";
import * as reports from "./reports.ts";
import { executeD1Plan, type Plan, type PlanResult } from "./plan-sql.ts";
import { systemActor as sysActor } from "./actor.ts";

export { anon, systemActor, actorFromSession, ForbiddenError, type Actor } from "./actor.ts";
export { type SupabaseAuthUser, authUserRow } from "./mirror.ts";
export { shadowRead, dualWrite, mirrorToD1, type DiffLogger, type ShadowDiff } from "./shadow.ts";
export { dataBackend, usesD1, type DataBackend } from "./backend.ts";
/** Configuración sensible cifrada (`integration_settings`). Solo para código de servidor que ya validó al admin. */
export { readAppSettings, writeAppSettings } from "./integration-settings-app.ts";
/** Base inyectable en tests (node:sqlite); en producción se usa el binding único. */
export type { SqlDatabase as IntegrationSettingsDb } from "./sql.ts";
export { argentinaDay, argentinaDayRangeUtc, toUtcIso } from "./time.ts";
export { toCents, fromCents } from "./money.ts";
export { CLIENT_ORDER_FIELDS, CLIENT_ORDER_SELECT, type ClientOrderField } from "./client-order-fields.ts";
export { comparableClientOrder, type ClientOrder, type ClientLedgerEntry } from "./client-views.ts";
export { comparableProduct, comparableCategory, type ApiProduct, type ApiCategory, type UpdateResult, type DeleteResult } from "./catalog-admin.ts";

type Bound<F> = F extends (db: SqlDatabase, actor: Actor, ...rest: infer A) => infer R ? (...rest: A) => R : never;
const bind = <F extends (db: SqlDatabase, actor: Actor, ...rest: never[]) => unknown>(f: F, db: SqlDatabase, actor: Actor) =>
  ((...rest: never[]) => f(db, actor, ...rest)) as Bound<F>;

export function bindRepos(db: SqlDatabase, actor: Actor) {
  return {
    clients: {
      get: bind(clients.getClient, db, actor),
      own: bind(clients.getOwnClient, db, actor),
      list: bind(clients.listClients, db, actor),
      createOwn: bind(clients.createOwnClient, db, actor),
      update: bind(clients.updateClient, db, actor),
      ownProfile: bind(clients.getOwnProfile, db, actor),
    },
    orders: {
      list: bind(orders.listOrders, db, actor),
      get: bind(orders.getOrder, db, actor),
      items: bind(orders.listOrderItems, db, actor),
      setStatus: bind(orders.setOrderStatus, db, actor),
      claim: bind(orders.claimOrder, db, actor),
      assign: bind(orders.assignOrder, db, actor),
    },
    points: { ledger: bind(points.listLedger, db, actor), add: bind(points.addPoints, db, actor) },
    reviews: {
      list: bind(reviews.listReviews, db, actor),
      createOwn: bind(reviews.createOwnReview, db, actor),
      eligibility: bind(reviews.reviewEligibility, db, actor),
    },
    legal: { own: bind(legal.listOwnLegal, db, actor), accept: bind(legal.acceptOwnLegal, db, actor), all: bind(legal.listAllLegal, db, actor) },
    catalog: {
      products: bind(catalog.listProducts, db, actor),
      categories: bind(catalog.listCategories, db, actor),
      upsertProduct: bind(catalog.upsertProduct, db, actor),
      upsertCategory: bind(catalog.upsertCategory, db, actor),
      getConfig: bind(catalog.getConfig, db, actor),
      listConfig: bind(catalog.listConfig, db, actor),
      setConfigMany: bind(catalog.setConfigMany, db, actor),
      setConfig: bind(catalog.setConfig, db, actor),
      dailyReports: bind(catalog.listDailyReports, db, actor),
    },
    clientViews: {
      orders: bind(clientViews.listOwnOrders, db, actor),
      order: bind(clientViews.getOwnOrder, db, actor),
      reviewedOrderIds: bind(clientViews.listOwnReviewedOrderIds, db, actor),
      ledger: bind(clientViews.listOwnLedger, db, actor),
      earnedByOrder: bind(clientViews.listOwnEarnedByOrder, db, actor),
    },
    catalogAdmin: {
      products: bind(catalogAdmin.listAllProducts, db, actor),
      categories: bind(catalogAdmin.listAllCategories, db, actor),
      createProduct: bind(catalogAdmin.createProduct, db, actor),
      updateProduct: bind(catalogAdmin.updateProduct, db, actor),
      deleteProduct: bind(catalogAdmin.deleteProduct, db, actor),
      createCategory: bind(catalogAdmin.createCategory, db, actor),
      updateCategory: bind(catalogAdmin.updateCategory, db, actor),
      deleteCategory: bind(catalogAdmin.deleteCategory, db, actor),
    },
    zones: {
      list: bind(zones.listAllZones, db, actor),
      create: bind(zones.createZone, db, actor),
      update: bind(zones.updateZone, db, actor),
      remove: bind(zones.deleteZone, db, actor),
    },
    reports: { upsertDaily: bind(reports.upsertDailyReport, db, actor) },
    payments: {
      get: bind(payments.getPaymentIntent, db, actor),
      create: bind(payments.createPaymentIntent, db, actor),
      approve: bind(payments.approvePaymentIntent, db, actor),
      close: bind(payments.closePaymentIntent, db, actor),
      cancelOwn: bind(payments.cancelOwnPaymentIntent, db, actor),
    },
    couriers: {
      list: bind(couriers.listCouriers, db, actor),
      byPinHash: bind(couriers.findCourierByPinHash, db, actor),
      byPinHashes: bind(couriers.findCourierByPinHashes, db, actor),
      upsertOwnLocation: bind(couriers.upsertOwnLocation, db, actor),
      locations: bind(couriers.listLocations, db, actor),
      requestOwnShift: bind(couriers.requestOwnShift, db, actor),
      ownShift: bind(couriers.getOwnShift, db, actor),
      decideShift: bind(couriers.decideShift, db, actor),
    },
    pins: {
      isLocked: bind(pins.isPinLocked, db, actor),
      recordFailure: bind(pins.recordPinFailure, db, actor),
      clear: bind(pins.clearPinFailures, db, actor),
    },
    staffTable: bind(restricted.listStaffTable, db, actor),
    mirror: {
      order: bind(mirror.mirrorOrderRow, db, actor),
      orderEvents: bind(mirror.mirrorOrderEvents, db, actor),
      courier: bind(mirror.mirrorCourierRow, db, actor),
      shift: bind(mirror.mirrorShiftRow, db, actor),
      location: bind(mirror.mirrorLocationRow, db, actor),
      locationDelete: bind(mirror.mirrorLocationDelete, db, actor),
      rows: bind(mirror.mirrorRows, db, actor),
      authUsers: bind(mirror.mirrorAuthUsers, db, actor),
    },
    // Ventas en Fudo al confirmar/cobrar/cancelar pedidos (solo staff/sistema). El gateway se inyecta.
    fudoSales: {
      onStatus: bind(fudoSales.onOrderStatusChange, db, actor),
      retry: bind(fudoSales.retryOrderSale, db, actor),
      pending: bind(fudoSales.listPendingSales, db, actor),
    },
    // Etapa 4: versión por topic en lugar de Realtime (sin datos, autorizada por actor).
    liveVersions: bind(live.liveVersions, db, actor),
    purgeLiveVersions: bind(live.purgeLiveVersions, db, actor),
  };
}

export { parseTopics as parseLiveTopics } from "./live.ts";
export type { FudoWriteGateway, GatewayResult, PendingSale, SaleSyncResult } from "./fudo-sales.ts";

export type DataApi = ReturnType<typeof bindRepos>;

/** Requiere DATA_BACKEND=dual|d1; con el default (supabase) lanza. */
export async function dataFor(actor: Actor): Promise<DataApi> {
  return bindRepos(await getDb(), actor);
}

/**
 * Etapa 1 del corte (DATA_BACKEND=d1): ejecuta en D1 un plan del cliente compatible con supabase-js.
 * Equivale al service-role: la autorización sigue en cada ruta. Ver plan-sql.ts.
 */
export async function executePlanInD1(plan: Plan): Promise<PlanResult> {
  return executeD1Plan(await getDb(), sysActor("admin-client"), plan);
}
export type { Plan as D1Plan, PlanResult as D1PlanResult } from "./plan-sql.ts";

// --- Etapa 3: sesiones de Better Auth (solo DATA_BACKEND=d1) -------------------------------
export type { SessionUser } from "./session.ts";

/** Better Auth sobre D1. `sendResetPassword` lo inyecta la ruta /api/auth (correo del local). */
export async function getAuth(sendResetPassword?: (to: string, url: string) => Promise<void>) {
  return session.runtimeAuth(await getDb(), sendResetPassword);
}

export async function sessionUser(headers: Headers): Promise<session.SessionUser | null> {
  return session.sessionUserWith(await getAuth(), headers);
}

export async function setLegalVersion(userId: string, version: string): Promise<boolean> {
  return session.setLegalVersionWith(await getDb(), userId, version);
}

export async function createCourierUser(name: string): Promise<string> {
  return session.createCourierUserWith(await getDb(), name);
}

export async function setCourierBlocked(userId: string, blocked: boolean): Promise<boolean> {
  return session.setCourierBlockedWith(await getDb(), userId, blocked);
}

export async function courierSessionCookies(userId: string): Promise<string[] | null> {
  return session.courierSessionCookiesWith(await getAuth(), userId);
}

export { staffUsersApp, type StaffUsersApp } from "./staff-users-app.ts";
export type { StaffUser, CourierUser, CreateStaffInput, UpdateStaffInput, UserResult, UserFailure } from "./staff-users.ts";

export { dataDeletionApp, type DataDeletionApp } from "./data-deletion-app.ts";
export type { DeletionPreview, DeletionRequestView, DeletionResult, DeletionOutcome, Eligibility, StaffUserView } from "./data-deletion.ts";

export { kbApp } from "./kb-negocio-app.ts";
export { kbInputSchema, KB_CATEGORIAS, type KbEntry, type KbInput } from "./kb-negocio.ts";
export { kbAprendizajeApp } from "./kb-aprendizaje-app.ts";
export {
  reclamosApp, reclamoEstadoSchema, reclamoAccionSchema, reclamoFiltrosSchema, RECLAMO_CATEGORIAS, RECLAMO_ESTADOS,
  ReclamoNoEncontradoError, ReclamoConflictoError,
  type Reclamo, type ReclamoEstado, type ReclamoDetalle, type ReclamoEvento, type ReclamoAccion, type ReclamoFiltros,
  type ReclamoCategoria, type ReclamoEstadoValor, type ReclamosResumen, type ReclamoAvisoContexto, type ReclamoReciente, type ConfigReclamos, type ContextoAgenteDatos,
} from "./reclamos.ts";
export { decisionSchema, type KbError, type KbSugerencia } from "./kb-aprendizaje.ts";
export { claimBotNonce } from "./bot-nonces.ts";
export {
  cartaApp,
  cartaInputSchema,
  CartaError,
  type CartaInput,
  type CartaAdminVista,
  type CartaSeccionVista,
  type CartaItemVista,
  type CartaProductoRef,
} from "./carta.ts";
