/**
 * Eliminación de usuarios desde la app: binding D1 único (getDb) + Better Auth sobre él + el dueño principal y el secreto del entorno.
 * Las rutas no tocan el binding. El aviso por email (notify) lo inyecta la ruta: el correo no vive en esta capa.
 */
import { superOwnerEmailFrom } from "../auth/owner-rules.ts";
import type { Actor } from "./actor.ts";
import type { Auth } from "./auth.ts";
import {
  deleteOwnAccount, deleteUserAsOwner, listDeletableUsers, listDeletionRequests, ownAccountEligibility, previewUserDeletion,
  type DeletionOptions, type DeletionOutcome, type DeletionPreview, type DeletionRequestView, type DeletionResult, type Eligibility, type StaffUserView,
} from "./data-deletion.ts";
import type { SqlDatabase } from "./sql.ts";

async function appDb(): Promise<SqlDatabase> {
  const { getDb } = await import("./db.ts");
  return getDb();
}

async function appAuth(db: SqlDatabase): Promise<Auth> {
  const { runtimeAuth } = await import("./session.ts");
  return runtimeAuth(db);
}

/**
 * Sin SUPER_OWNER_EMAIL no hay dueño principal: la herramienta del panel queda cerrada para todos. Sin DATA_DELETION_HASH_SECRET
 * (secreto del Worker, mínimo 32 caracteres) la eliminación queda deshabilitada, también la del propio personal.
 */
const options = (notify?: DeletionOptions["notify"]): DeletionOptions => ({
  superOwnerEmail: superOwnerEmailFrom(process.env),
  hashSecret: process.env.DATA_DELETION_HASH_SECRET?.trim() || null,
  notify,
});

type Notify = DeletionOptions["notify"];

export const dataDeletionApp = {
  users: async (actor: Actor, exactEmail?: string): Promise<DeletionOutcome<StaffUserView[]>> => listDeletableUsers(await appDb(), actor, options(), exactEmail),
  recent: async (actor: Actor): Promise<DeletionRequestView[]> => listDeletionRequests(await appDb(), actor, options()),
  preview: async (actor: Actor, userId: string): Promise<DeletionOutcome<DeletionPreview>> => previewUserDeletion(await appDb(), actor, userId, options()),
  execute: async (
    actor: Actor, input: { userId: string; token: string; password: string; confirmEmail: string }, notify?: Notify,
  ): Promise<DeletionOutcome<DeletionResult>> => {
    const db = await appDb();
    return deleteUserAsOwner(db, await appAuth(db), actor, input, options(notify));
  },
  eligibility: async (userId: string): Promise<Eligibility> => ownAccountEligibility(await appDb(), userId, options()),
  deleteOwn: async (userId: string, password: string, notify?: Notify): Promise<DeletionOutcome<DeletionResult>> => {
    const db = await appDb();
    return deleteOwnAccount(db, await appAuth(db), { userId, password }, options(notify));
  },
};

export type DataDeletionApp = typeof dataDeletionApp;
