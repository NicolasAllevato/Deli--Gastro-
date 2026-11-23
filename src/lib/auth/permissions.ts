/**
 * Permisos por sección del personal del local (admin, gerente, cajero).
 *
 * Módulo PURO (sin imports de Next, Supabase ni de la capa de datos): lo usan el proxy, los guards
 * de las rutas, el menú del panel y las pruebas. El acceso al portal sigue siendo `role = 'admin'`;
 * lo que acota a gerentes y cajeros es `staff_role` + `permissions` (columnas de "user" en D1).
 *
 * Reglas:
 * - `admin` (dueño) siempre tiene todo en "editar" y puede gestionar usuarios; ignora el JSON.
 * - Un usuario con rol de panel y sin `staff_role` (admin anterior a la migración, modo Supabase o demo)
 *   se trata como dueño: es lo que ya tenía antes de existir esta función.
 * - Ruta sin mapear = solo dueño (cerrado por defecto).
 */

export const SECTIONS = ["dashboard", "pedidos", "catalogo", "comunicacion", "zonas", "configuracion"] as const;
export type Section = (typeof SECTIONS)[number];

export const ACCESS_LEVELS = ["none", "view", "edit"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const STAFF_ROLES = ["admin", "gerente", "cajero"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export type Permissions = Readonly<Record<Section, AccessLevel>>;

export const SECTION_LABELS: Readonly<Record<Section, string>> = {
  dashboard: "Dashboard",
  pedidos: "Pedidos",
  catalogo: "Catálogo",
  comunicacion: "Comunicación",
  zonas: "Zonas de entrega",
  configuracion: "Configuración",
};

export const STAFF_ROLE_LABELS: Readonly<Record<StaffRole, string>> = {
  admin: "Dueño",
  gerente: "Gerente",
  cajero: "Cajero",
};

export const ACCESS_LEVEL_LABELS: Readonly<Record<AccessLevel, string>> = {
  none: "Ninguno",
  view: "Ver",
  edit: "Editar",
};

const ALL_EDIT: Permissions = Object.freeze({
  dashboard: "edit",
  pedidos: "edit",
  catalogo: "edit",
  comunicacion: "edit",
  zonas: "edit",
  configuracion: "edit",
});

export const DEFAULT_PERMISSIONS: Readonly<Record<StaffRole, Permissions>> = Object.freeze({
  admin: ALL_EDIT,
  gerente: Object.freeze({
    dashboard: "view",
    pedidos: "edit",
    catalogo: "edit",
    comunicacion: "edit",
    zonas: "edit",
    configuracion: "view",
  }),
  cajero: Object.freeze({
    dashboard: "none",
    pedidos: "edit",
    catalogo: "view",
    comunicacion: "view",
    zonas: "none",
    configuracion: "none",
  }),
});

/** Página de entrada de cada sección. Tiene que coincidir con `href` de NAV_SECTIONS (lo verifica un test). */
export const SECTION_HOME: Readonly<Record<Section, string>> = {
  dashboard: "/admin/ejecutivo",
  pedidos: "/admin/tablero",
  catalogo: "/admin/productos",
  comunicacion: "/admin/conversaciones",
  zonas: "/admin/zonas",
  configuracion: "/admin/configuracion",
};

const RANK: Readonly<Record<AccessLevel, number>> = { none: 0, view: 1, edit: 2 };

export const isSection = (v: unknown): v is Section => typeof v === "string" && (SECTIONS as readonly string[]).includes(v);
export const isAccessLevel = (v: unknown): v is AccessLevel => typeof v === "string" && (ACCESS_LEVELS as readonly string[]).includes(v);
export const isStaffRole = (v: unknown): v is StaffRole => typeof v === "string" && (STAFF_ROLES as readonly string[]).includes(v);

/** ¿`level` alcanza para lo que se pide? */
export function levelAtLeast(level: AccessLevel, needed: AccessLevel): boolean {
  return RANK[level] >= RANK[needed];
}

/**
 * Rol de personal de un usuario con rol de panel. Sin dato (NULL / modo Supabase o demo) = dueño;
 * un valor presente pero desconocido cae en el más restringido (nunca ensancha el acceso).
 */
export function normalizeStaffRole(raw: unknown): StaffRole {
  if (isStaffRole(raw)) return raw;
  if (raw === null || raw === undefined || raw === "") return "admin";
  return "cajero";
}

/**
 * Ajustes por sección guardados como JSON. Lo que no se pueda interpretar (JSON roto, no objeto) devuelve null
 * y el rol queda con sus valores por defecto; las entradas sueltas inválidas se ignoran.
 */
export function parsePermissionsJson(raw: unknown): Partial<Record<Section, AccessLevel>> | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Partial<Record<Section, AccessLevel>> = {};
  for (const section of SECTIONS) {
    const level = (value as Record<string, unknown>)[section];
    if (isAccessLevel(level)) out[section] = level;
  }
  return out;
}

/** Permisos efectivos: dueño siempre todo; el resto, defaults del rol pisados por el JSON válido. */
export function resolvePermissions(staffRole: unknown, permissionsJson?: unknown): Permissions {
  const role = normalizeStaffRole(staffRole);
  if (role === "admin") return ALL_EDIT;
  return Object.freeze({ ...DEFAULT_PERMISSIONS[role], ...(parsePermissionsJson(permissionsJson) ?? {}) });
}

/**
 * Lo que se guarda en `user.permissions`: solo las secciones que difieren de los defaults del rol
 * (así, si los defaults cambian, lo no tocado los sigue). `null` = sin ajustes; el dueño nunca guarda ajustes.
 */
export function serializePermissions(staffRole: StaffRole, permissions: Partial<Record<Section, AccessLevel>> | undefined): string | null {
  if (staffRole === "admin" || !permissions) return null;
  const base = DEFAULT_PERMISSIONS[staffRole];
  const diff: Partial<Record<Section, AccessLevel>> = {};
  for (const section of SECTIONS) {
    const level = permissions[section];
    if (level !== undefined && level !== base[section]) diff[section] = level;
  }
  return Object.keys(diff).length > 0 ? JSON.stringify(diff) : null;
}

/** Quién es y qué puede, ya resuelto. */
export interface StaffAccess {
  staffRole: StaffRole;
  permissions: Permissions;
}

/** Acceso a partir de los campos de la sesión (`app_metadata`). Sin datos = dueño (ver cabecera). */
export function staffAccessOf(meta: Readonly<Record<string, unknown>> | null | undefined): StaffAccess {
  const staffRole = normalizeStaffRole(meta?.staff_role);
  return { staffRole, permissions: resolvePermissions(staffRole, meta?.permissions) };
}

/** Sin ninguna sección: para cuando no hay sesión que resolver. */
export const NO_ACCESS: StaffAccess = Object.freeze({
  staffRole: "cajero" as StaffRole,
  permissions: Object.freeze({ dashboard: "none", pedidos: "none", catalogo: "none", comunicacion: "none", zonas: "none", configuracion: "none" } as const),
});

export const canManageUsers = (access: Pick<StaffAccess, "staffRole">): boolean => access.staffRole === "admin";

export const levelFor = (access: StaffAccess, section: Section): AccessLevel => access.permissions[section];

/** Primera sección que el usuario puede ver, en el orden del menú. */
export function firstAllowedSection(access: StaffAccess): Section | null {
  return SECTIONS.find((s) => levelAtLeast(access.permissions[s], "view")) ?? null;
}

/** Página de entrada de la primera sección permitida (o null si no tiene ninguna). */
export function firstAllowedHome(access: StaffAccess): string | null {
  const section = firstAllowedSection(access);
  return section ? SECTION_HOME[section] : null;
}

// --- Mapeo de rutas -----------------------------------------------------------------------------

/** Minúsculas, sin query/hash, sin barras repetidas ni barra final. Los prefijos se comparan por segmento. */
export function normalizePath(pathname: string): string {
  let p = pathname.split("?")[0].split("#")[0].toLowerCase().replace(/\/{2,}/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

const within = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** Páginas del panel (las pestañas de `_nav.ts`) → sección. */
const PAGE_RULES: ReadonlyArray<readonly [string, Section]> = [
  ["/admin/ejecutivo", "dashboard"],
  ["/admin/informes", "dashboard"],
  ["/admin/tablero", "pedidos"],
  ["/admin/pedidos", "pedidos"],
  ["/admin/mapa", "pedidos"],
  ["/admin/repartidores", "pedidos"],
  ["/admin/productos", "catalogo"],
  ["/admin/puntos", "catalogo"],
  ["/admin/conversaciones", "comunicacion"],
  ["/admin/reclamos", "comunicacion"],
  ["/admin/agente", "comunicacion"],
  ["/admin/conocimiento", "comunicacion"],
  ["/admin/plantillas", "comunicacion"],
  ["/admin/campanas", "comunicacion"],
  ["/admin/whatsapp", "comunicacion"],
  ["/admin/zonas", "zonas"],
  ["/admin/configuracion", "configuracion"],
  ["/admin/carta", "configuracion"],
  ["/admin/fudo", "configuracion"],
  ["/admin/promos", "configuracion"],
  ["/admin/notificaciones", "configuracion"],
  ["/admin/legal", "configuracion"],
  ["/admin/usuarios", "configuracion"],
  ["/admin/eliminar-datos", "configuracion"],
];

/**
 * Solo el dueño, aunque tengan la sección en "editar": la gestión de usuarios y la Conexión de WhatsApp
 * (credenciales, token, webhook, registro del número y diagnóstico). El resto de Comunicación no cambia.
 * La eliminación de usuarios de la app es además solo del dueño PRINCIPAL: eso lo exigen la ruta y la capa de datos
 * (acá se corta a gerentes y cajeros; un dueño común recibe el 403 del servidor).
 */
const OWNER_ONLY_PREFIXES: readonly string[] = [
  "/admin/usuarios",
  "/api/admin/usuarios",
  "/admin/eliminar-datos",
  "/api/admin/eliminar-datos",
  "/admin/whatsapp",
  "/api/whatsapp/config",
  "/api/whatsapp/link",
  "/api/whatsapp/embedded-signup",
  "/api/whatsapp/test",
];

/**
 * Pantallas del panel que puede abrir TODO el personal, sin permiso de sección: "Mi cuenta" (cambiar o eliminar la propia cuenta).
 * Los endpoints propios (`/api/account/*`) no pasan por acá: autentican la sesión y operan siempre sobre quien llama.
 */
const SELF_SERVICE_PAGES: readonly string[] = ["/admin/mi-cuenta"];

interface ApiRule {
  prefix: string;
  /** Secciones que dan acceso: alcanza con que UNA tenga el nivel pedido. */
  sections: readonly Section[];
  /** Si se define, quién puede LEER (GET/HEAD); escribir sigue siendo `sections`. */
  read?: readonly Section[];
  /** El POST de este endpoint no modifica nada (consulta): pide "ver", no "editar". */
  postIsRead?: boolean;
}

/**
 * Endpoints → secciones. Varios endpoints los comparten pantallas de más de una sección
 * (por ejemplo /api/products lo usan Catálogo y la Carta de Configuración), por eso hay listas.
 * /api/config tiene además un chequeo por clave en su PATCH (ver `canWriteConfigKeys`).
 */
const API_RULES: readonly ApiRule[] = [
  { prefix: "/api/admin/carta", sections: ["configuracion"] },
  { prefix: "/api/admin/catalog", sections: ["catalogo"] },
  { prefix: "/api/admin/clients", sections: ["dashboard"] },
  { prefix: "/api/admin/conocimiento", sections: ["comunicacion"] },
  { prefix: "/api/admin/conversaciones", sections: ["comunicacion"] },
  { prefix: "/api/admin/courier-shifts", sections: ["pedidos"] },
  { prefix: "/api/admin/couriers", sections: ["pedidos"] },
  { prefix: "/api/admin/daily-summary", sections: ["configuracion"] },
  { prefix: "/api/admin/executive", sections: ["dashboard"] },
  { prefix: "/api/admin/fudo-map", sections: ["configuracion"] },
  { prefix: "/api/admin/fudo-sync", sections: ["configuracion"] },
  { prefix: "/api/admin/fudo-ventas", sections: ["configuracion"] },
  { prefix: "/api/admin/legal", sections: ["configuracion"] },
  { prefix: "/api/admin/reclamos", sections: ["comunicacion"] },
  // El POST es la consulta al analista (herramientas de solo lectura): alcanza con ver el Dashboard.
  { prefix: "/api/admin/reports", sections: ["dashboard"], postIsRead: true },
  { prefix: "/api/agent", sections: ["comunicacion"] },
  { prefix: "/api/categories", sections: ["catalogo"] },
  { prefix: "/api/config", sections: ["configuracion", "zonas", "comunicacion"] },
  { prefix: "/api/couriers", sections: ["pedidos"] },
  { prefix: "/api/dispatch", sections: ["pedidos"] },
  { prefix: "/api/orders", sections: ["pedidos"] },
  { prefix: "/api/products", sections: ["catalogo", "configuracion"] },
  { prefix: "/api/upload", sections: ["catalogo", "configuracion"] },
  { prefix: "/api/whatsapp", sections: ["comunicacion"] },
  // El mapa de Pedidos dibuja las zonas: lectura también para quien ve Pedidos.
  { prefix: "/api/zones", sections: ["zonas"], read: ["zonas", "pedidos"] },
];

const apiRuleFor = (path: string): ApiRule | undefined => API_RULES.find((r) => within(path, r.prefix));

/** Sección de una página del panel (`/admin/...`), o null si no está mapeada. */
export function sectionForPath(pathname: string): Section | null {
  const path = normalizePath(pathname);
  return PAGE_RULES.find(([prefix]) => within(path, prefix))?.[1] ?? null;
}

/** Sección principal de un endpoint (`/api/...`), o null si no está mapeado. Ver `sectionsForApi` para las alternativas. */
export function sectionForApi(pathname: string): Section | null {
  const rule = apiRuleFor(normalizePath(pathname));
  return rule?.sections[0] ?? null;
}

const READ_METHODS = new Set(["GET", "HEAD"]);
export const isReadMethod = (method: string): boolean => READ_METHODS.has(method.toUpperCase());

/** ¿Este pedido modifica datos? GET/HEAD no; el POST de un endpoint marcado `postIsRead` tampoco. */
const isWrite = (rule: ApiRule | undefined, method: string): boolean =>
  !(isReadMethod(method) || (rule?.postIsRead === true && method.toUpperCase() === "POST"));

/** Secciones que dan acceso a un endpoint con ese método (alcanza con una), o null si no está mapeado. */
export function sectionsForApi(pathname: string, method = "GET"): readonly Section[] | null {
  const rule = apiRuleFor(normalizePath(pathname));
  if (!rule) return null;
  return !isWrite(rule, method) && rule.read ? rule.read : rule.sections;
}

export const isOwnerOnlyPath = (pathname: string): boolean => {
  const path = normalizePath(pathname);
  return OWNER_ONLY_PREFIXES.some((p) => within(path, p));
};

// --- Decisión de acceso -------------------------------------------------------------------------

export type AccessDenial = "owner-only" | "unmapped" | "forbidden" | "read-only";
export type AccessDecision = { allowed: true } | { allowed: false; reason: AccessDenial; section: Section | null };

const allow: AccessDecision = { allowed: true };
const deny = (reason: AccessDenial, section: Section | null): AccessDecision => ({ allowed: false, reason, section });

function decideBySections(access: StaffAccess, sections: readonly Section[], write: boolean): AccessDecision {
  const needed: AccessLevel = write ? "edit" : "view";
  if (sections.some((s) => levelAtLeast(access.permissions[s], needed))) return allow;
  const canView = sections.some((s) => levelAtLeast(access.permissions[s], "view"));
  return deny(write && canView ? "read-only" : "forbidden", sections[0] ?? null);
}

/**
 * ¿Puede este usuario pedir esta URL con este método? Sirve para páginas (`/admin/...`, método GET) y
 * para endpoints (`/api/...`): GET/HEAD piden "ver"; cualquier otro método pide "editar".
 * El dueño pasa siempre; para el resto, lo que no está mapeado queda cerrado.
 */
export function evaluateAccess(access: StaffAccess, pathname: string, method = "GET"): AccessDecision {
  if (canManageUsers(access)) return allow;
  const path = normalizePath(pathname);
  if (path === "/admin") return allow; // solo redirige a la primera pantalla; la pantalla se valida aparte
  if (SELF_SERVICE_PAGES.some((p) => within(path, p))) return allow;
  if (isOwnerOnlyPath(path)) {
    return deny("owner-only", path.startsWith("/api/") ? sectionForApi(path) : sectionForPath(path));
  }

  if (path.startsWith("/api/")) {
    const sections = sectionsForApi(path, method);
    return sections ? decideBySections(access, sections, isWrite(apiRuleFor(path), method)) : deny("unmapped", null);
  }
  const section = sectionForPath(path);
  return section ? decideBySections(access, [section], !isReadMethod(method)) : deny("unmapped", null);
}

export const canAccessPath = (access: StaffAccess, pathname: string, method = "GET"): boolean =>
  evaluateAccess(access, pathname, method).allowed;

// --- Claves de /api/config ----------------------------------------------------------------------

/** Secciones que pueden escribir cada clave de `global_config`. Lo no listado es de Configuración. */
const CONFIG_KEY_SECTIONS: Readonly<Record<string, readonly Section[]>> = {
  local_lat: ["zonas", "configuracion"],
  local_lng: ["zonas", "configuracion"],
  radio_delivery_km: ["zonas", "configuracion"],
  // El Agente IA guarda estos junto con los suyos.
  agente_activo: ["comunicacion", "configuracion"],
  agente_audios: ["comunicacion", "configuracion"],
  agente_nombre: ["comunicacion", "configuracion"],
  agente_tono: ["comunicacion", "configuracion"],
  agente_instrucciones: ["comunicacion", "configuracion"],
  negocio_nombre: ["comunicacion", "configuracion"],
  horario_apertura: ["comunicacion", "configuracion"],
  horario_cierre: ["comunicacion", "configuracion"],
};

/** ¿Puede escribir TODAS estas claves de /api/config? (para cada una alcanza con editar una de sus secciones) */
export function canWriteConfigKeys(access: StaffAccess, keys: readonly string[]): boolean {
  if (canManageUsers(access)) return true;
  return keys.every((key) => (CONFIG_KEY_SECTIONS[key] ?? ["configuracion"]).some((s) => access.permissions[s] === "edit"));
}
