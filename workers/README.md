# Cloudflare Workers — Deli-Gastro

Estos Workers reemplazan los webhooks de n8n para las rutas `/api/dispatch` y `/api/chat`.
Corren en el edge de Cloudflare: 0 ms cold start, sin servidor que mantener.

## Workers disponibles

| Worker | Carpeta | Reemplaza |
|---|---|---|
| `deli-gastro-dispatcher` | `dispatcher/` | `N8N_DISPATCHER_URL` |
| `deli-gastro-chatbot` | `chatbot/` | `N8N_WEBHOOK_URL_CHATBOT` |

---

## Deploy en 3 pasos

### Paso 1 — Autenticarse en Cloudflare

```bash
npx wrangler login
```

Se abre el navegador. Aceptar el acceso. Una sola vez por máquina.

---

### Paso 2 — Deployar cada Worker

```bash
# Dispatcher
cd workers/dispatcher
npx wrangler deploy

# Chatbot
cd ../chatbot
npx wrangler deploy
```

Al finalizar cada deploy, Wrangler imprime la URL pública del Worker, por ejemplo:

```
https://deli-gastro-dispatcher.<tu-subdominio>.workers.dev
https://deli-gastro-chatbot.<tu-subdominio>.workers.dev
```

#### Secret del chatbot (solo la primera vez)

Antes de deployar el chatbot, cargar el API key de Anthropic como secret:

```bash
cd workers/chatbot
npx wrangler secret put ANTHROPIC_API_KEY
# Wrangler pide el valor — pegarlo y Enter. Nunca queda en el repo.
```

---

### Paso 3 — Copiar las URLs a Vercel

En el dashboard de Vercel, ir a **Settings > Environment Variables** del proyecto
`deli-gastro` y reemplazar o agregar:

| Variable | Valor |
|---|---|
| `N8N_DISPATCHER_URL` | `https://deli-gastro-dispatcher.<subdominio>.workers.dev` |
| `N8N_WEBHOOK_URL_CHATBOT` | `https://deli-gastro-chatbot.<subdominio>.workers.dev` |

Hacer un nuevo deploy en Vercel para que tome las variables actualizadas.

---

## Probar localmente (opcional)

```bash
# En una terminal, iniciar el Worker en modo desarrollo
cd workers/chatbot
npx wrangler dev

# En otra terminal, enviar un request de prueba
curl -X POST http://localhost:8787 \
  -H "Content-Type: application/json" \
  -d '{"message": "Hola, que hay en el menú?", "clientId": "test-123"}'
```

Para el dispatcher con modo dev, agregar la variable de entorno localmente:

```bash
# workers/chatbot/.dev.vars  (este archivo NO se commitea, agregarlo a .gitignore)
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Estructura de archivos

```
workers/
├── README.md               # Este archivo
├── dispatcher/
│   ├── index.js            # Lógica del Worker (ESM)
│   └── wrangler.toml       # Configuración de Wrangler
└── chatbot/
    ├── index.js            # Lógica del Worker (ESM)
    └── wrangler.toml       # Configuración de Wrangler
```
