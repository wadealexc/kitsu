#!/usr/bin/env bash
# Dev mode: backend on :8071 (restarts on changes) and frontend on :5050 with live
# reload and the debug bridge (see frontend/vite-debug-bridge.ts). Stop the docker
# container first; this uses the same config, data and JWT secret (.env).
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
[ -f .env ] && . ./.env
set +a

mkdir -p frontend/.debug
[ -f frontend/.debug/token ] || (umask 077 && openssl rand -hex 16 > frontend/.debug/token)

# A second copy of kitsu can run beside the first: set these in its .env, and
# ports.backend.port in its config.json.
BACKEND_PORT="${KITSU_BACKEND_PORT:-8071}"
FRONTEND_PORT="${KITSU_FRONTEND_PORT:-5050}"

trap 'kill 0' EXIT INT TERM
(cd backend && npx tsx watch src/index.ts) &
(cd frontend && KITSU_HMR=1 VITE_DEBUG_BRIDGE=1 KITSU_DEBUG_TOKEN="$(cat .debug/token)" KITSU_DEBUG_DIR=.debug \
    BACKEND_URL="http://localhost:$BACKEND_PORT" npx vite dev --port "$FRONTEND_PORT") &
wait
