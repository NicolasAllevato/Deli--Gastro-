/**
 * Deli-Gastro Dispatcher Worker
 *
 * Reemplaza el webhook de n8n para acciones internas del sistema.
 * Recibe POST con { action: string, data: object } y las procesa en el edge.
 */

const ALLOWED_ACTIONS = new Set(["new_order", "status_update", "create_ticket"]);

/**
 * @param {string} action
 * @param {Record<string, unknown>} data
 * @returns {Promise<Response>}
 */
async function handleAction(action, data) {
  switch (action) {
    case "new_order":
      // Punto de extensión: enviar notificación push, email, SMS, etc.
      console.log("[dispatcher] new_order recibida:", JSON.stringify(data));
      return Response.json({ ok: true });

    case "status_update":
      console.log("[dispatcher] status_update recibida:", JSON.stringify(data));
      return Response.json({ ok: true });

    case "create_ticket":
      console.log("[dispatcher] create_ticket recibida:", JSON.stringify(data));
      return Response.json({ ok: true });

    default:
      // Nunca llega aquí porque validamos antes, pero por seguridad:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
}

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   * @param {ExecutionContext} ctx
   * @returns {Promise<Response>}
   */
  async fetch(request, env, ctx) {
    // Solo aceptar POST
    if (request.method !== "POST") {
      return Response.json({ error: "Method Not Allowed" }, { status: 405 });
    }

    // Parsear body
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { action, data = {} } = body;

    // Validar que la acción sea un string y esté entre las permitidas
    if (!action || typeof action !== "string" || !ALLOWED_ACTIONS.has(action)) {
      return Response.json({ error: "Unknown action" }, { status: 400 });
    }

    // Validar que data sea un objeto
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return Response.json({ error: "data must be an object" }, { status: 400 });
    }

    return handleAction(action, data);
  },
};
