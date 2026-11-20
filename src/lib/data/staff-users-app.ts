/** Usuarios del personal desde la app: binding D1 único (getDb) + Better Auth sobre él. Las rutas no tocan el binding. */
import { SUPER_OWNER_ENV, superOwnerEmailFrom } from "../auth/owner-rules.ts";
import type { Actor } from "./actor.ts";
import type { Auth } from "./auth.ts";
import {
  createStaffUser, listStaffUsers, updateStaffUser,
  type CourierUser, type CreateStaffInput, type StaffRulesOptions, type StaffUser, type StaffViewer, type UpdateStaffInput, type UserResult,
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

/**
 * Dueño principal desde el entorno (variable o secreto del Worker). Sin configurar, el comportamiento es el seguro
 * (nadie edita a otro dueño ni crea dueños) y se avisa en el log en cada uso para que no pase desapercibido.
 */
function rulesOptions(): StaffRulesOptions {
  const superOwnerEmail = superOwnerEmailFrom(process.env);
  if (superOwnerEmail === null) {
    console.warn(
      `[usuarios] ${SUPER_OWNER_ENV} no está configurada: ningún dueño puede editar a otro dueño ni crear dueños. ` +
        "Definila como variable o secreto del Worker con el email del dueño principal.",
    );
  }
  return { superOwnerEmail };
}

export const staffUsersApp = {
  list: async (actor: Actor): Promise<{ staff: StaffUser[]; couriers: CourierUser[]; viewer: StaffViewer }> =>
    listStaffUsers(await appDb(), actor, rulesOptions()),
  create: async (actor: Actor, input: CreateStaffInput): Promise<UserResult<StaffUser>> => {
    const db = await appDb();
    return createStaffUser(db, await appAuth(db), actor, input, rulesOptions());
  },
  update: async (actor: Actor, id: string, patch: UpdateStaffInput): Promise<UserResult<StaffUser>> => {
    const db = await appDb();
    return updateStaffUser(db, await appAuth(db), actor, id, patch, rulesOptions());
  },
};

export type StaffUsersApp = typeof staffUsersApp;
