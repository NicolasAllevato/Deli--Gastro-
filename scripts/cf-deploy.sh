#!/usr/bin/env bash
# Deploy de la app a Cloudflare (OpenNext) sin empaquetar .env.local ni usar su CLOUDFLARE_API_TOKEN
# (es de otra cuenta → error 10000). Mueve .env.local afuera durante el build y lo devuelve SIEMPRE
# (trap), aunque el build falle o se corte. Uso: bash scripts/cf-deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env.local"
[ -f "$ENV_FILE" ] || { echo "No está $ENV_FILE; no despliego." >&2; exit 1; }

BACKUP_DIR="${HOME}/.deli-gastro-env-backups"
mkdir -p "$BACKUP_DIR"
STASH="$BACKUP_DIR/env.local.$(date +%Y%m%d-%H%M%S)"
cp "$ENV_FILE" "$STASH.copia"          # copia permanente, por las dudas
mv "$ENV_FILE" "$STASH"
restore() { [ -f "$STASH" ] && mv "$STASH" "$ENV_FILE" && echo ".env.local restaurado."; }
trap restore EXIT INT TERM

# Solo las NEXT_PUBLIC_* y R2_PUBLIC_BASE_URL (host de fotos para next/image y la CSP; se hornean en el build), con la URL del dominio nuevo.
set -a
eval "$(grep -E '^(NEXT_PUBLIC_|R2_PUBLIC_BASE_URL=)' "$STASH" | grep -v '^NEXT_PUBLIC_APP_URL')"
set +a
export NEXT_PUBLIC_APP_URL="https://opsyndely.la-gambeta.com"
export NEXT_PUBLIC_SITE_URL="https://opsyndely.la-gambeta.com"
# El navegador decide Supabase o D1 con NEXT_PUBLIC_DATA_BACKEND (se hornea en el build): se toma
# siempre de DATA_BACKEND de wrangler.jsonc para que nunca queden distintos.
NEXT_PUBLIC_DATA_BACKEND="$(node -e 'const t=require("fs").readFileSync("wrangler.jsonc","utf8");const m=t.match(/"DATA_BACKEND"\s*:\s*"([a-z0-9]+)"/);if(!m){process.exit(1)}console.log(m[1])')"
export NEXT_PUBLIC_DATA_BACKEND
echo "Build con DATA_BACKEND=$NEXT_PUBLIC_DATA_BACKEND"

env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID npm run cf:deploy
