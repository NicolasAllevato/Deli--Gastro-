/**
 * Permisos por sección del personal: defaults, resolución, mapeo de rutas (páginas y endpoints), decisión de acceso,
 * menú filtrado y coherencia con `_nav.ts`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./helpers/alias.ts";

const P = await import("../src/lib/auth/permissions.ts");
const { staffAccessDenial, configKeysDenial, adminPageDecision, READ_ONLY_MESSAGE, FORBIDDEN_MESSAGE } = await import("../src/lib/auth/staff-guard.ts");
const { NAV_SECTIONS, visibleNavSections, findSection } = await import("../src/app/admin/_nav.ts");

const owner = P.staffAccessOf({ staff_role: "admin" });
const gerente = P.staffAccessOf({ staff_role: "gerente" });
const cajero = P.staffAccessOf({ staff_role: "cajero" });
const metaOf = (staff_role: string, permissions?: string) => ({ staff_role, ...(permissions ? { permissions } : {}) });

describe("defaults por rol", () => {
  it("dueño: todo en editar", () => {
    for (const s of P.SECTIONS) assert.equal(P.DEFAULT_PERMISSIONS.admin[s], "edit");
  });

  it("gerente", () => {
    assert.deepEqual({ ...P.DEFAULT_PERMISSIONS.gerente }, {
      dashboard: "view", pedidos: "edit", catalogo: "edit", comunicacion: "edit", zonas: "edit", configuracion: "view",
    });
  });

  it("cajero", () => {
    assert.deepEqual({ ...P.DEFAULT_PERMISSIONS.cajero }, {
      dashboard: "none", pedidos: "edit", catalogo: "view", comunicacion: "view", zonas: "none", configuracion: "none",
    });
  });
});

describe("resolvePermissions", () => {
  it("el dueño ignora el JSON y siempre tiene todo en editar", () => {
    const resolved = P.resolvePermissions("admin", JSON.stringify({ pedidos: "none", configuracion: "none" }));
    for (const s of P.SECTIONS) assert.equal(resolved[s], "edit");
  });

  it("gerente y cajero: defaults pisados por el JSON válido", () => {
    assert.equal(P.resolvePermissions("gerente", JSON.stringify({ configuracion: "edit", pedidos: "view" })).configuracion, "edit");
    assert.equal(P.resolvePermissions("gerente", JSON.stringify({ pedidos: "view" })).pedidos, "view");
    assert.equal(P.resolvePermissions("gerente", JSON.stringify({ pedidos: "view" })).catalogo, "edit", "lo no ajustado sigue el default");
    assert.equal(P.resolvePermissions("cajero", JSON.stringify({ zonas: "view" })).zonas, "view");
  });

  it("JSON roto o que no es un objeto: defaults", () => {
    for (const bad of ["{no es json", "", "   ", "[]", "42", '"texto"', "null", null, undefined]) {
      assert.deepEqual({ ...P.resolvePermissions("cajero", bad) }, { ...P.DEFAULT_PERMISSIONS.cajero }, `entrada ${String(bad)}`);
    }
  });

  it("ignora secciones desconocidas y niveles inválidos entrada por entrada", () => {
    const resolved = P.resolvePermissions("cajero", JSON.stringify({ pedidos: "dios", inventada: "edit", zonas: "view" }));
    assert.equal(resolved.pedidos, "edit", "nivel inválido: queda el default");
    assert.equal(resolved.zonas, "view");
    assert.equal("inventada" in resolved, false);
  });

  it("sin rol (modo Supabase, demo o admin anterior a la migración) = dueño; rol desconocido = el más restringido", () => {
    for (const none of [null, undefined, ""]) assert.equal(P.normalizeStaffRole(none), "admin");
    assert.equal(P.normalizeStaffRole("superusuario"), "cajero");
    assert.equal(P.staffAccessOf(undefined).staffRole, "admin");
    assert.equal(P.staffAccessOf({ role: "admin", provider: "demo" }).permissions.configuracion, "edit");
    assert.equal(P.staffAccessOf({ staff_role: "superusuario" }).permissions.configuracion, "none");
  });
});

describe("serializePermissions", () => {
  it("guarda solo lo que difiere de los defaults del rol", () => {
    assert.equal(P.serializePermissions("gerente", { ...P.DEFAULT_PERMISSIONS.gerente }), null);
    assert.deepEqual(JSON.parse(P.serializePermissions("gerente", { ...P.DEFAULT_PERMISSIONS.gerente, configuracion: "edit" }) ?? "null"), { configuracion: "edit" });
    assert.equal(P.serializePermissions("admin", { pedidos: "none" }), null, "el dueño nunca guarda ajustes");
    assert.equal(P.serializePermissions("cajero", undefined), null);
  });
});

describe("sectionForPath: todas las pantallas del menú", () => {
  it("cada pestaña de _nav.ts cae en la sección de su ítem", () => {
    for (const item of NAV_SECTIONS) {
      assert.equal(P.sectionForPath(item.href), item.section, item.href);
      for (const tab of item.tabs) assert.equal(P.sectionForPath(tab.href), item.section, tab.href);
    }
  });

  it("la entrada de cada sección (SECTION_HOME) es el href del menú", () => {
    for (const item of NAV_SECTIONS) assert.equal(P.SECTION_HOME[item.section], item.href);
    assert.deepEqual(NAV_SECTIONS.map((s) => s.section), [...P.SECTIONS], "mismo orden que SECTIONS");
  });

  it("mapea las rutas indicadas", () => {
    const expected: Record<string, string> = {
      "/admin/informes": "dashboard", "/admin/ejecutivo": "dashboard",
      "/admin/pedidos": "pedidos", "/admin/mapa": "pedidos", "/admin/repartidores": "pedidos", "/admin/tablero": "pedidos",
      "/admin/puntos": "catalogo", "/admin/productos": "catalogo",
      "/admin/agente": "comunicacion", "/admin/plantillas": "comunicacion", "/admin/campanas": "comunicacion",
      "/admin/whatsapp": "comunicacion", "/admin/conversaciones": "comunicacion", "/admin/reclamos": "comunicacion", "/admin/conocimiento": "comunicacion",
      "/admin/zonas": "zonas",
      "/admin/carta": "configuracion", "/admin/fudo": "configuracion", "/admin/promos": "configuracion",
      "/admin/notificaciones": "configuracion", "/admin/legal": "configuracion", "/admin/usuarios": "configuracion", "/admin/configuracion": "configuracion",
    };
    for (const [path, section] of Object.entries(expected)) assert.equal(P.sectionForPath(path), section, path);
  });

  it("subrutas, barra final, mayúsculas y query", () => {
    assert.equal(P.sectionForPath("/admin/pedidos/abc-123"), "pedidos");
    assert.equal(P.sectionForPath("/admin/tablero/"), "pedidos");
    assert.equal(P.sectionForPath("/ADMIN/Mapa?x=1#y"), "pedidos");
    assert.equal(P.sectionForPath("//admin//zonas"), "zonas");
  });

  it("no se deja engañar por prefijos parecidos ni por rutas sin mapear", () => {
    assert.equal(P.sectionForPath("/admin/pedidosx"), null);
    assert.equal(P.sectionForPath("/admin/usuarios-2"), null);
    assert.equal(P.sectionForPath("/admin/inventada"), null);
    assert.equal(P.sectionForPath("/cliente/pedidos"), null);
    assert.equal(P.sectionForPath("/api/orders"), null, "los endpoints se mapean con sectionForApi");
  });
});

describe("sectionForApi", () => {
  it("mapea los endpoints del panel", () => {
    const expected: Record<string, string> = {
      "/api/admin/executive": "dashboard", "/api/admin/executive/settings": "dashboard", "/api/admin/reports": "dashboard", "/api/admin/reports/export": "dashboard",
      "/api/admin/clients/export": "dashboard",
      "/api/orders": "pedidos", "/api/orders/delivered": "pedidos", "/api/couriers": "pedidos", "/api/couriers/location": "pedidos",
      "/api/dispatch": "pedidos", "/api/admin/couriers": "pedidos", "/api/admin/couriers/abc/pin": "pedidos", "/api/admin/courier-shifts": "pedidos",
      "/api/products": "catalogo", "/api/categories": "catalogo", "/api/admin/catalog/import": "catalogo", "/api/admin/catalog/export": "catalogo",
      "/api/whatsapp/conversations": "comunicacion", "/api/whatsapp/conversations/abc": "comunicacion", "/api/whatsapp/templates": "comunicacion",
      "/api/whatsapp/campaigns/preview": "comunicacion", "/api/whatsapp/config": "comunicacion", "/api/agent/config": "comunicacion", "/api/agent/test": "comunicacion",
      "/api/admin/conocimiento": "comunicacion", "/api/admin/conocimiento/aprendizaje": "comunicacion", "/api/admin/reclamos": "comunicacion", "/api/admin/reclamos/resumen": "comunicacion",
      "/api/zones": "zonas",
      "/api/config": "configuracion", "/api/admin/carta": "configuracion", "/api/admin/fudo-map": "configuracion", "/api/admin/fudo-sync": "configuracion",
      "/api/admin/fudo-ventas": "configuracion", "/api/admin/legal": "configuracion", "/api/admin/daily-summary": "configuracion",
    };
    for (const [path, section] of Object.entries(expected)) assert.equal(P.sectionForApi(path), section, path);
  });

  it("sin mapear devuelve null", () => {
    for (const path of ["/api/admin/algo-nuevo", "/api/admin", "/api/internal/bot/status", "/api/clientes", "/api/ordersx"]) {
      assert.equal(P.sectionForApi(path), null, path);
    }
  });

  it("los endpoints compartidos tienen varias secciones y /api/zones se lee también desde Pedidos", () => {
    assert.deepEqual([...(P.sectionsForApi("/api/products", "PATCH") ?? [])], ["catalogo", "configuracion"]);
    assert.deepEqual([...(P.sectionsForApi("/api/zones", "GET") ?? [])], ["zonas", "pedidos"]);
    assert.deepEqual([...(P.sectionsForApi("/api/zones", "POST") ?? [])], ["zonas"]);
    assert.equal(P.sectionsForApi("/api/sin-mapa"), null);
  });
});

describe("evaluateAccess", () => {
  it("el dueño pasa siempre, incluso por rutas sin mapear y de solo dueño", () => {
    for (const path of ["/admin/usuarios", "/api/admin/usuarios", "/admin/inventada", "/api/admin/otra", "/admin/tablero"]) {
      assert.equal(P.evaluateAccess(owner, path, "DELETE").allowed, true, path);
    }
  });

  it("GET pide ver, el resto pide editar", () => {
    // cajero: catalogo view
    assert.equal(P.evaluateAccess(cajero, "/api/products", "GET").allowed, true);
    const write = P.evaluateAccess(cajero, "/api/products", "POST");
    assert.deepEqual(write, { allowed: false, reason: "read-only", section: "catalogo" });
    for (const method of ["PATCH", "PUT", "DELETE"]) assert.equal(P.evaluateAccess(cajero, "/api/products", method).allowed, false, method);
    assert.equal(P.evaluateAccess(cajero, "/api/products", "HEAD").allowed, true);
    // pedidos edit
    assert.equal(P.evaluateAccess(cajero, "/api/orders", "PATCH").allowed, true);
  });

  it("el POST del analista de Informes es una consulta: alcanza con ver el Dashboard (gerente sí, cajero no)", () => {
    assert.equal(P.evaluateAccess(gerente, "/api/admin/reports", "POST").allowed, true);
    assert.equal(P.evaluateAccess(cajero, "/api/admin/reports", "POST").allowed, false);
    // el resto de los endpoints del Dashboard siguen pidiendo editar para escribir
    assert.deepEqual(P.evaluateAccess(gerente, "/api/admin/executive/settings", "PATCH"), { allowed: false, reason: "read-only", section: "dashboard" });
    assert.equal(P.evaluateAccess(gerente, "/api/admin/reports", "DELETE").allowed, false);
  });

  it("sección en 'none': prohibido aun para leer", () => {
    assert.deepEqual(P.evaluateAccess(cajero, "/api/zones", "PATCH"), { allowed: false, reason: "forbidden", section: "zonas" });
    assert.equal(P.evaluateAccess(cajero, "/api/admin/reports", "GET").allowed, false);
    assert.equal(P.evaluateAccess(cajero, "/admin/informes", "GET").allowed, false);
  });

  it("ruta sin mapear: solo dueño (cerrado por defecto)", () => {
    for (const path of ["/api/admin/algo-nuevo", "/admin/inventada", "/api/otra-cosa"]) {
      assert.deepEqual(P.evaluateAccess(gerente, path, "GET"), { allowed: false, reason: "unmapped", section: null }, path);
    }
  });

  it("gestión de usuarios: solo dueño aunque tengan configuración en editar", () => {
    const configEditor = P.staffAccessOf(metaOf("gerente", JSON.stringify({ configuracion: "edit" })));
    assert.equal(P.evaluateAccess(configEditor, "/admin/configuracion", "GET").allowed, true);
    for (const path of ["/admin/usuarios", "/api/admin/usuarios", "/api/admin/usuarios/abc", "/ADMIN/usuarios/"]) {
      const decision = P.evaluateAccess(configEditor, path, "GET");
      assert.equal(decision.allowed, false, path);
      assert.equal(decision.allowed === false && decision.reason, "owner-only", path);
    }
  });

  it("Conexión de WhatsApp (credenciales, token, webhook, registro y diagnóstico): solo dueño, aun con Comunicación en editar", () => {
    const comunicacionEditor = P.staffAccessOf(metaOf("cajero", JSON.stringify({ comunicacion: "edit" })));
    const ownerOnly = [
      ["/admin/whatsapp", "GET"], ["/admin/whatsapp/", "GET"],
      ["/api/whatsapp/config", "GET"], ["/api/whatsapp/config", "PUT"],
      ["/api/whatsapp/link", "POST"], ["/api/whatsapp/embedded-signup", "POST"], ["/api/whatsapp/test", "POST"],
    ] as const;
    for (const access of [gerente, cajero, comunicacionEditor]) {
      for (const [path, method] of ownerOnly) {
        const d = P.evaluateAccess(access, path, method);
        assert.equal(d.allowed === false && d.reason, "owner-only", `${method} ${path}`);
      }
    }
    for (const [path, method] of ownerOnly) assert.equal(P.evaluateAccess(owner, path, method).allowed, true, `${method} ${path}`);
  });

  it("el resto de Comunicación no cambia: conversaciones, plantillas, campañas, agente, reclamos, conocimiento", () => {
    for (const path of ["/admin/conversaciones", "/admin/plantillas", "/admin/campanas", "/admin/agente", "/admin/reclamos", "/admin/conocimiento"]) {
      assert.equal(P.evaluateAccess(gerente, path, "GET").allowed, true, path);
    }
    for (const path of ["/api/whatsapp/conversations", "/api/whatsapp/conversations/abc", "/api/whatsapp/templates", "/api/whatsapp/campaigns", "/api/whatsapp/campaigns/preview", "/api/agent/config"]) {
      assert.equal(P.evaluateAccess(gerente, path, "POST").allowed, true, `gerente POST ${path}`);
      assert.equal(P.evaluateAccess(cajero, path, "GET").allowed, true, `cajero GET ${path}`);
      assert.equal(P.evaluateAccess(cajero, path, "POST").allowed, false, `cajero POST ${path}`);
    }
  });

  it("/admin solo redirige y pasa para cualquiera con acceso al panel", () => {
    assert.equal(P.evaluateAccess(cajero, "/admin", "GET").allowed, true);
    assert.equal(P.evaluateAccess(cajero, "/admin/", "GET").allowed, true);
  });

  it("quien ve Pedidos puede leer las zonas (el mapa las dibuja) pero no escribirlas", () => {
    assert.equal(P.evaluateAccess(cajero, "/api/zones", "GET").allowed, true, "cajero: zonas none, pedidos edit");
    assert.equal(P.evaluateAccess(cajero, "/api/zones", "POST").allowed, false);
    const sinPedidos = P.staffAccessOf(metaOf("cajero", JSON.stringify({ pedidos: "none" })));
    assert.equal(P.evaluateAccess(sinPedidos, "/api/zones", "GET").allowed, false, "sin zonas ni pedidos no lee");
  });
});

describe("firstAllowedHome / canManageUsers", () => {
  it("primera sección permitida en el orden del menú", () => {
    assert.equal(P.firstAllowedHome(owner), "/admin/ejecutivo");
    assert.equal(P.firstAllowedHome(gerente), "/admin/ejecutivo");
    assert.equal(P.firstAllowedHome(cajero), "/admin/tablero");
    assert.equal(P.firstAllowedHome(P.staffAccessOf(metaOf("cajero", JSON.stringify({ pedidos: "none", catalogo: "none", comunicacion: "none" })))), null);
    assert.equal(P.firstAllowedHome(P.NO_ACCESS), null);
  });

  it("solo el dueño gestiona usuarios", () => {
    assert.equal(P.canManageUsers(owner), true);
    assert.equal(P.canManageUsers(gerente), false);
    assert.equal(P.canManageUsers(cajero), false);
    assert.equal(P.canManageUsers(P.NO_ACCESS), false);
  });
});

describe("canWriteConfigKeys (PATCH /api/config)", () => {
  it("cada clave se escribe desde su sección", () => {
    const zonasOnly = P.staffAccessOf(metaOf("cajero", JSON.stringify({ zonas: "edit" })));
    assert.equal(P.canWriteConfigKeys(zonasOnly, ["radio_delivery_km"]), true);
    assert.equal(P.canWriteConfigKeys(zonasOnly, ["local_lat", "local_lng"]), true);
    assert.equal(P.canWriteConfigKeys(zonasOnly, ["modo_pausa"]), false, "clave de Configuración");
    assert.equal(P.canWriteConfigKeys(zonasOnly, ["radio_delivery_km", "modo_pausa"]), false, "todas las claves tienen que poder");
  });

  it("el gerente (Comunicación en editar) guarda los ajustes del Agente IA pero no los de Configuración", () => {
    assert.equal(P.canWriteConfigKeys(gerente, ["agente_activo", "agente_tono", "negocio_nombre", "horario_apertura"]), true);
    assert.equal(P.canWriteConfigKeys(gerente, ["puntos_por_100"]), false, "configuracion solo ver");
    assert.equal(P.canWriteConfigKeys(gerente, ["radio_delivery_km"]), true, "zonas editar");
  });

  it("el cajero no escribe configuración; el dueño todo", () => {
    assert.equal(P.canWriteConfigKeys(cajero, ["agente_activo"]), false);
    assert.equal(P.canWriteConfigKeys(cajero, ["modo_pausa"]), false);
    assert.equal(P.canWriteConfigKeys(owner, ["modo_pausa", "agente_activo", "cualquier_otra"]), true);
  });
});

describe("staff-guard (lo que usa requireRole)", () => {
  const req = (path: string, method = "GET") => ({ url: `https://opsyndely.la-gambeta.com${path}`, method });

  it("sin staff_role (Supabase, demo) pasa todo", () => {
    assert.equal(staffAccessDenial({ role: "admin" }, req("/api/admin/usuarios", "POST")), null);
    assert.equal(staffAccessDenial(undefined, req("/api/orders")), null);
  });

  it("dueño pasa; gerente/cajero según sección y método", () => {
    assert.equal(staffAccessDenial(metaOf("admin"), req("/api/admin/usuarios", "POST")), null);
    assert.equal(staffAccessDenial(metaOf("gerente"), req("/api/admin/reports")), null);
    assert.equal(staffAccessDenial(metaOf("gerente"), req("/api/config", "PATCH")), null, "agente/zonas en editar: pasa el filtro de ruta; las claves se validan aparte");
    assert.equal(staffAccessDenial(metaOf("gerente"), req("/api/admin/executive/settings", "PATCH")), READ_ONLY_MESSAGE);
    assert.equal(staffAccessDenial(metaOf("cajero"), req("/api/admin/reports")), FORBIDDEN_MESSAGE);
    assert.equal(staffAccessDenial(metaOf("cajero"), req("/api/whatsapp/conversations")), null);
    assert.equal(staffAccessDenial(metaOf("cajero"), req("/api/whatsapp/conversations/abc", "POST")), READ_ONLY_MESSAGE);
    assert.equal(staffAccessDenial(metaOf("gerente"), req("/api/admin/usuarios")), FORBIDDEN_MESSAGE);
  });

  it("endpoints de Conexión de WhatsApp: solo dueño aunque Comunicación esté en editar", () => {
    for (const path of ["/api/whatsapp/config", "/api/whatsapp/link", "/api/whatsapp/embedded-signup", "/api/whatsapp/test"]) {
      assert.equal(staffAccessDenial(metaOf("gerente"), req(path, "POST")), FORBIDDEN_MESSAGE, path);
      assert.equal(staffAccessDenial(metaOf("cajero"), req(path, "GET")), FORBIDDEN_MESSAGE, path);
      assert.equal(staffAccessDenial(metaOf("admin"), req(path, "POST")), null, path);
    }
  });

  it("sin pedido (no se sabe qué quiere) o con URL rota: solo el dueño", () => {
    assert.equal(staffAccessDenial(metaOf("admin")), null);
    assert.equal(staffAccessDenial(metaOf("gerente")), FORBIDDEN_MESSAGE);
    assert.equal(staffAccessDenial(metaOf("gerente"), { url: "no-es-una-url", method: "GET" }), FORBIDDEN_MESSAGE);
  });

  it("claves de /api/config", () => {
    assert.equal(configKeysDenial(metaOf("gerente"), ["agente_nombre"]), null);
    assert.notEqual(configKeysDenial(metaOf("gerente"), ["puntos_por_100"]), null);
    assert.equal(configKeysDenial(undefined, ["puntos_por_100"]), null, "sin staff_role = dueño");
  });
});

describe("proxy: páginas del panel (adminPageDecision)", () => {
  it("el dueño y los modos sin staff_role entran a todo", () => {
    for (const path of ["/admin/ejecutivo", "/admin/usuarios", "/admin/inventada"]) {
      assert.deepEqual(adminPageDecision(metaOf("admin"), path), { kind: "allow" }, path);
      assert.deepEqual(adminPageDecision({ role: "admin", provider: "demo" }, path), { kind: "allow" }, path);
    }
  });

  it("sin ver la sección: redirige a la primera sección permitida", () => {
    assert.deepEqual(adminPageDecision(metaOf("cajero"), "/admin/ejecutivo"), { kind: "redirect", to: "/admin/tablero" });
    assert.deepEqual(adminPageDecision(metaOf("cajero"), "/admin/zonas"), { kind: "redirect", to: "/admin/tablero" });
    assert.deepEqual(adminPageDecision(metaOf("cajero"), "/admin/informes"), { kind: "redirect", to: "/admin/tablero" });
    assert.deepEqual(adminPageDecision(metaOf("gerente"), "/admin/usuarios"), { kind: "redirect", to: "/admin/ejecutivo" });
    assert.deepEqual(adminPageDecision(metaOf("gerente"), "/admin/whatsapp"), { kind: "redirect", to: "/admin/ejecutivo" });
    assert.deepEqual(adminPageDecision(metaOf("cajero"), "/admin/whatsapp"), { kind: "redirect", to: "/admin/tablero" });
    assert.deepEqual(adminPageDecision(metaOf("gerente"), "/admin/pantalla-nueva"), { kind: "redirect", to: "/admin/ejecutivo" });
  });

  it("con ver alcanza para abrir la página; /admin redirige solo", () => {
    assert.deepEqual(adminPageDecision(metaOf("cajero"), "/admin/productos"), { kind: "allow" });
    assert.deepEqual(adminPageDecision(metaOf("gerente"), "/admin/configuracion"), { kind: "allow" });
    assert.deepEqual(adminPageDecision(metaOf("cajero"), "/admin"), { kind: "allow" });
  });

  it("sin ninguna sección: /login", () => {
    const none = JSON.stringify({ pedidos: "none", catalogo: "none", comunicacion: "none" });
    assert.deepEqual(adminPageDecision(metaOf("cajero", none), "/admin/tablero"), { kind: "login" });
  });

  it("el destino de la redirección siempre está permitido (no hay bucles)", () => {
    for (const role of ["gerente", "cajero"]) {
      const access = P.staffAccessOf(metaOf(role));
      const home = P.firstAllowedHome(access);
      assert.ok(home && P.evaluateAccess(access, home, "GET").allowed, role);
    }
  });
});

describe("menú filtrado por permisos", () => {
  const tabsOf = (sections: ReadonlyArray<{ tabs: ReadonlyArray<{ href: string }> }>) => sections.flatMap((s) => s.tabs.map((t) => t.href));

  it("dueño: todo, incluida la pestaña Usuarios", () => {
    const menu = visibleNavSections(owner);
    assert.equal(menu.length, NAV_SECTIONS.length);
    assert.ok(tabsOf(menu).includes("/admin/usuarios"));
    assert.ok(tabsOf(menu).includes("/admin/legal"));
    assert.ok(tabsOf(menu).includes("/admin/whatsapp"));
  });

  it("gerente: ve Configuración (solo ver) pero no la pestaña Usuarios ni la Conexión de WhatsApp", () => {
    const menu = visibleNavSections(gerente);
    assert.deepEqual(menu.map((s) => s.section), [...P.SECTIONS]);
    assert.equal(tabsOf(menu).includes("/admin/usuarios"), false);
    assert.equal(tabsOf(menu).includes("/admin/whatsapp"), false);
    assert.ok(tabsOf(menu).includes("/admin/carta"));
    assert.ok(tabsOf(menu).includes("/admin/conversaciones"), "el resto de Comunicación sigue");
  });

  it("cajero: sin Dashboard, Zonas ni Configuración; la sección apunta a su primera pestaña visible", () => {
    const menu = visibleNavSections(cajero);
    assert.deepEqual(menu.map((s) => s.section), ["pedidos", "catalogo", "comunicacion"]);
    assert.equal(menu.find((s) => s.section === "pedidos")?.href, "/admin/tablero");
    assert.equal(findSection("/admin/mapa", menu)?.section, "pedidos");
    assert.equal(tabsOf(menu).includes("/admin/whatsapp"), false);
    assert.equal(findSection("/admin/zonas", menu), undefined);
  });

  it("sin permisos no queda ninguna sección", () => {
    assert.equal(visibleNavSections(P.NO_ACCESS).length, 0);
  });

  it("los ajustes por usuario se reflejan en el menú", () => {
    const onlyComms = P.staffAccessOf(metaOf("cajero", JSON.stringify({ pedidos: "none", catalogo: "none" })));
    const menu = visibleNavSections(onlyComms);
    assert.deepEqual(menu.map((s) => s.section), ["comunicacion"]);
    assert.equal(menu[0].href, "/admin/conversaciones");
  });
});
