FROM node:22.20.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN CI=1 pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
FROM node:22.20.0-bookworm-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/patches ./patches
RUN CI=1 pnpm install --prod --frozen-lockfile && pnpm store prune
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/vendor ./vendor
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/server/control/*.sql ./server/control/
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
