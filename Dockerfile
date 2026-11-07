# kitsu: backend API plus the built frontend, served from one container.
#
#   docker compose up -d --build
#
# Needs config.json (mounted) and WEBUI_SECRET_KEY (from .env); see README.

# ---- frontend: static SvelteKit build ----
FROM node:26-slim AS frontend
WORKDIR /src
# The frontend imports shared types from ../backend/src
COPY backend/src backend/src
COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd frontend && npm ci --no-audit --no-fund
COPY frontend frontend
ARG KITSU_VERSION=dev
RUN cd frontend && KITSU_VERSION=$KITSU_VERSION npm run build

# ---- backend: compile TypeScript ----
FROM node:26-slim AS backend
WORKDIR /src/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY backend ./
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

# ---- runtime ----
FROM node:26-slim
ENV NODE_ENV=production \
    KITSU_CONFIG=/app/config.json \
    KITSU_FRONTEND_DIR=/app/frontend
WORKDIR /app/backend
COPY --from=backend /src/backend/node_modules node_modules
COPY --from=backend /src/backend/dist dist
COPY --from=backend /src/backend/drizzle drizzle
COPY --from=backend /src/backend/static static
COPY --from=backend /src/backend/package.json package.json
COPY --from=frontend /src/frontend/build /app/frontend
RUN mkdir -p data logs && chown -R node:node /app/backend
USER node
EXPOSE 8071
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD node -e "fetch('http://127.0.0.1:8071/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/src/index.js"]
