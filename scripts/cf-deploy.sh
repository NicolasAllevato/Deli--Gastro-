#!/usr/bin/env bash
# Deploy de la app a Cloudflare (OpenNext). Uso: bash scripts/cf-deploy.sh
# Local con poca RAM: usar scripts/deploy-local.ps1 (libera memoria, reintenta y verifica).
# Opciones por entorno:
#   SOLO_SUBIR=1  no recompila si .open-next ya es del commit actual (sello .open-next/.build-commit).
#   DRY_RUN=1     compila y revisa sin subir.
#   ENV_FILE=...  archivo env a leer (por defecto .env.local; en GitHub Actions lo arma el workflow).
#   CI=true       (GitHub Actions) sube con CLOUDFLARE_API_TOKEN en vez de la sesión de wrangler.
# En Windows lanzarlo desde PowerShell: & "C:\Program Files\Git\bin\bash.exe" scripts/cf-deploy.sh
# (desde la consola de git-bash Turbopack falla con 0xc0000142).
#
# REGLA: .env.local JAMÁS se borra, mueve ni renombra. Este script solo lo LEE.
# Para que sus secretos no terminen en el Worker:
#   1. Next no carga archivos env (__NEXT_PROCESSED_ENV=true); solo se pasan las NEXT_PUBLIC_*.
#   2. OpenNext copia los .env* a .open-next/cloudflare/next-env.mjs: se vacía después del build.
#   3. Antes de subir se busca cada valor secreto de .env.local en .open-next; si aparece, se aborta.
#   4. Se sube con wrangler sin CLOUDFLARE_API_TOKEN/ACCOUNT_ID (el de .env.local es de otra cuenta).
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-.env.local}"
ACCOUNT_ID="e7351dd776e005da826ba6f2a5aae4c1"
[ -f "$ENV_FILE" ] || { echo "No está $ENV_FILE; no despliego." >&2; exit 1; }
grep -q "\"account_id\": \"$ACCOUNT_ID\"" wrangler.jsonc || { echo "wrangler.jsonc no apunta a la cuenta $ACCOUNT_ID." >&2; exit 1; }

# Sin copias de respaldo: solo existe el original (decisión de la usuaria, 2026-11-20).
check_env() { [ -f "$ENV_FILE" ] || { echo "ALERTA: falta $ENV_FILE" >&2; exit 1; }; }
trap check_env EXIT

# Solo las NEXT_PUBLIC_* y R2_PUBLIC_BASE_URL (se hornean en el build), con la URL del dominio.
set -a
eval "$(grep -E '^(NEXT_PUBLIC_|R2_PUBLIC_BASE_URL=)' "$ENV_FILE" | grep -v '^NEXT_PUBLIC_APP_URL')"
set +a
export NEXT_PUBLIC_APP_URL="https://opsyndely.la-gambeta.com"
export NEXT_PUBLIC_SITE_URL="https://opsyndely.la-gambeta.com"
# NEXT_PUBLIC_DATA_BACKEND sale siempre de DATA_BACKEND de wrangler.jsonc para que nunca queden distintos.
NEXT_PUBLIC_DATA_BACKEND="$(node -e 'const t=require("fs").readFileSync("wrangler.jsonc","utf8");const m=t.match(/"DATA_BACKEND"\s*:\s*"([a-z0-9]+)"/);if(!m){process.exit(1)}console.log(m[1])')"
export NEXT_PUBLIC_DATA_BACKEND
export __NEXT_PROCESSED_ENV=true
echo "Build con DATA_BACKEND=$NEXT_PUBLIC_DATA_BACKEND"

# Sin token en local (el de .env.local es de otra cuenta); en CI el token es el de esta cuenta.
if [ "${CI:-}" = "true" ]; then
  : "${CLOUDFLARE_API_TOKEN:?En CI falta CLOUDFLARE_API_TOKEN}"
  export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID"
  CF=(env)
else
  CF=(env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID)
fi
# IPv4: por IPv6 la red local corta las subidas grandes con ECONNRESET («fetch failed»).
export NODE_OPTIONS="${NODE_OPTIONS:-} --dns-result-order=ipv4first"

COMMIT="$(git rev-parse HEAD 2>/dev/null || echo sin-git)"
DIRTY="$(git status --porcelain --untracked-files=no 2>/dev/null || true)"
STAMP=".open-next/.build-commit"
if [ "${SOLO_SUBIR:-}" = "1" ] && [ -z "$DIRTY" ] && [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$COMMIT" ]; then
  echo "SOLO_SUBIR: .open-next ya es del commit $COMMIT; no recompilo."
else
  "${CF[@]}" npx opennextjs-cloudflare build
  # 2. Vaciar las variables que OpenNext copió de los .env*.
  printf 'export const production = {};\nexport const development = {};\nexport const test = {};\n' > .open-next/cloudflare/next-env.mjs
  if [ -z "$DIRTY" ]; then echo "$COMMIT" > "$STAMP"; else rm -f "$STAMP"; fi
fi

# 3. Ningún valor secreto (no público, 12+ caracteres) de .env.local puede estar en el paquete.
node scripts/check-env-leak.mjs "$ENV_FILE" .open-next

# 4. Subir (DRY_RUN=1 compila y revisa sin subir).
[ "${DRY_RUN:-}" = "1" ] && { echo "DRY_RUN: build y revisión OK, no se sube."; exit 0; }
# Reintenta solo la subida (el build ya está hecho): los cortes de red son intermitentes.
for intento in 1 2 3; do
  if "${CF[@]}" npx wrangler deploy --config wrangler.jsonc; then exit 0; fi
  echo "La subida falló (intento $intento de 3)." >&2
  if [ "$intento" -lt 3 ]; then sleep $((intento * 15)); fi
done
echo "No se pudo subir. El build quedó hecho: reintentar con SOLO_SUBIR=1." >&2
exit 1
