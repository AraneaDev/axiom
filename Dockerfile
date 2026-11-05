FROM node:25-alpine AS base
RUN apk add --no-cache pandoc weasyprint font-noto
RUN addgroup -S axiom && adduser -S -G axiom axiom
WORKDIR /app

# Dependencies
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

# What production runs on, without the dev dependencies
FROM base AS prod-deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

# Frontend build
FROM node:25-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend ./
RUN npx vite build

# Build (the backend, plus the editor core bundle from frontend/src/editor-core,
# which resolves its dependencies from the frontend's node_modules)
FROM deps AS build
COPY --from=frontend-build /app/frontend ./frontend
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

# Production
FROM base AS production
ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/prisma ./prisma
COPY --from=prod-deps /app/prisma.config.ts ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-editor-core ./dist-editor-core
COPY --from=frontend-build /app/frontend/dist ./public
COPY --from=build /app/src/config/load-env.ts ./src/config/load-env.ts
COPY package.json ./
COPY scripts ./scripts

RUN mkdir -p /data/uploads && chown -R axiom:axiom /app /data

USER axiom

EXPOSE 3000

# Entry point per container: dist/index.js (api), dist/worker.js, dist/migrate.js
CMD ["node", "dist/index.js"]
