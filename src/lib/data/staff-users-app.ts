/** Usuarios del personal desde la app: binding D1 único (getDb) + Better Auth sobre él. Las rutas no tocan el binding. */
import type { Actor } from "./actor.ts";
import type { Auth } from "./auth.ts";
import {
  createStaffUser, listStaffUsers, updateStaffUser,
  type CourierUser, type CreateStaffInput, type StaffUser, type UpdateStaffInput, type UserResult,
} from "./staff-users.ts";
import type { SqlDatabase } from "./sql.ts";

async function appDb(): Promise<SqlDatabase> {
  const { getDb } = await import("./db.ts");
  return getDb();
}

async function appAuth(db: SqlDatabase): Promise<Auth> {
  const { runtimeAuth } = await import("./session.ts");
  return runtimeAuth(db);
}

export const staffUsersApp = {
  list: async (actor: Actor): Promise<{ staff: StaffUser[]; couriers: CourierUser[] }> => listStaffUsers(await appDb(), actor),
  create: async (actor: Actor, input: CreateStaffInput): Promise<UserResult<StaffUser>> => {
    const db = await appDb();
    return createStaffUser(db, await appAuth(db), actor, input);
  },
  update: async (actor: Actor, id: string, patch: UpdateStaffInput): Promise<UserResult<StaffUser>> => {
    const db = await appDb();
    return updateStaffUser(db, await appAuth(db), actor, id, patch);
  },
};

export type StaffUsersApp = typeof staffUsersApp;
