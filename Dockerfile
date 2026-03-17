# ============================================================
# Stage 1: Install all dependencies (dev + prod)
# ============================================================
FROM node:22-slim AS deps
WORKDIR /app

# git is needed: znn-typescript-sdk is a GitHub dependency with a prepare script
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Copy workspace root files
COPY package.json package-lock.json ./

# Copy workspace package.json files (needed for workspace resolution)
COPY backend/package.json backend/
COPY frontend/package.json frontend/

# Install all dependencies (including devDeps for build)
RUN npm ci

# ============================================================
# Stage 2: Build backend (TypeScript → dist/)
# ============================================================
FROM deps AS build-backend
WORKDIR /app

COPY tsconfig.base.json ./
COPY backend/ backend/

RUN npm run build --workspace=backend

# ============================================================
# Stage 3: Build frontend (Vite → dist/)
# ============================================================
FROM deps AS build-frontend
WORKDIR /app

COPY frontend/ frontend/

RUN npm run build --workspace=frontend

# ============================================================
# Stage 4: Production image (lean)
# ============================================================
FROM node:22-slim AS production
WORKDIR /app

# git still needed for npm ci of the GitHub SDK dependency
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Copy workspace root
COPY package.json package-lock.json ./
COPY backend/package.json backend/

# Install production dependencies only
RUN npm ci --workspace=backend --omit=dev

# Copy compiled backend from build stage
COPY --from=build-backend /app/backend/dist/ backend/dist/

# Copy non-compiled backend assets (JSON spec loaded at runtime)
COPY backend/src/openapi.json backend/src/openapi.json

# Copy migration scripts (plain JS, no build step needed)
COPY backend/scripts/*.mjs backend/scripts/

# Copy frontend build (extracted by deploy script into host volume for Caddy)
COPY --from=build-frontend /app/frontend/dist/ frontend/dist/

# Non-root user for security — use the built-in 'node' user (UID 1000) which
# matches the 'deploy' user on the host, so bind-mounted wallet (chmod 600) is readable
USER node

EXPOSE 3001

# Use node directly (not npm) so SIGTERM reaches the process for graceful shutdown
CMD ["node", "backend/dist/index.js"]
