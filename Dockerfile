FROM node:25-alpine AS base
RUN apk add --no-cache git pandoc weasyprint font-noto
RUN addgroup -S axiom && adduser -S -G axiom axiom
WORKDIR /app

# Dependencies
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

# Build
FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Production
FROM base AS production
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY --from=deps /app/prisma.config.ts ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/config/load-env.ts ./src/config/load-env.ts
COPY package.json ./
COPY scripts ./scripts

RUN mkdir -p /data/repos /data/uploads /data/ssh && chown -R axiom:axiom /app /data

USER axiom

EXPOSE 3000 2222

# Entry point per container: dist/index.js (api), dist/ssh.js, dist/worker.js, dist/migrate.js
CMD ["node", "dist/index.js"]
