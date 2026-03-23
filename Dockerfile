# ── Stage 1: Build ────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY tsconfig*.json ./
COPY src ./src
COPY public ./public

RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# ── Stage 2: Production image ─────────────────────────────────────
FROM node:22-alpine AS production

# Security: run as non-root
RUN addgroup -S monivo && adduser -S monivo -G monivo

WORKDIR /app

# Compiled JS, prod node_modules, and the static frontend
COPY --from=builder --chown=monivo:monivo /app/dist         ./dist
COPY --from=builder --chown=monivo:monivo /app/node_modules  ./node_modules
COPY --from=builder --chown=monivo:monivo /app/package.json  ./package.json
COPY --from=builder --chown=monivo:monivo /app/public        ./public

USER monivo

EXPOSE 3000

# Liveness probe — ECS restarts if this fails
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/health/live || exit 1

CMD ["node", "dist/main.js"]
