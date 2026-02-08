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

# Copy frontend build (extracted by deploy script into host volume for Caddy)
COPY --from=build-frontend /app/frontend/dist/ frontend/dist/

# Non-root user for security (UID 1000 matches 'deploy' on host so bind-mounted
# wallet keyfile with chmod 600 is readable inside the container)
RUN groupadd -r -g 1000 plasmabot && useradd -r -u 1000 -g plasmabot plasmabot
USER plasmabot

EXPOSE 3001

# Use node directly (not npm) so SIGTERM reaches the process for graceful shutdown
CMD ["node", "backend/dist/index.js"]
