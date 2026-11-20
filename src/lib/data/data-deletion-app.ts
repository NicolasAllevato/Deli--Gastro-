/**
 * Eliminación de datos desde la app: binding D1 único (getDb) + Better Auth sobre él + el dueño principal del entorno.
 * Las rutas no tocan el binding. El bucket de fotos (R2) no vive en esta capa: lo inyecta la ruta (`files`).
 */
import { superOwnerEmailFrom } from "../auth/owner-rules.ts";
import type { Actor } from "./actor.ts";
import type { Auth } from "./auth.ts";
import {
  deleteOwnAccount, deleteSubjectData, listDeletionRequests, ownAccountEligibility, previewDeletion,
  type DeletionOptions, type DeletionOutcome, type DeletionPreview, type DeletionRequestView, type DeletionResult, type Eligibility, type FileStore,
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

/** Sin SUPER_OWNER_EMAIL no hay dueño principal: la herramienta del panel queda cerrada para todos (modo seguro). */
const options = (files?: FileStore | null): DeletionOptions => ({ superOwnerEmail: superOwnerEmailFrom(process.env), files });

export const dataDeletionApp = {
  preview: async (actor: Actor, subject: { phone?: string; email?: string }): Promise<DeletionOutcome<DeletionPreview>> =>
    previewDeletion(await appDb(), actor, subject, options()),
  execute: async (
    actor: Actor, input: { phone?: string; email?: string; channel: "admin" | "email" }, files?: FileStore | null,
  ): Promise<DeletionOutcome<DeletionResult>> => deleteSubjectData(await appDb(), actor, input, options(files)),
  recent: async (actor: Actor): Promise<DeletionRequestView[]> => listDeletionRequests(await appDb(), actor, options()),
  eligibility: async (userId: string): Promise<Eligibility> => ownAccountEligibility(await appDb(), userId, options()),
  deleteOwn: async (userId: string, password: string, files?: FileStore | null): Promise<DeletionOutcome<DeletionResult>> => {
    const db = await appDb();
    return deleteOwnAccount(db, await appAuth(db), { userId, password }, options(files));
  },
};

export type DataDeletionApp = typeof dataDeletionApp;
