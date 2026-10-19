# AvaLab web image: pnpm workspace build (corepack-pinned via packageManager),
# static output served by Caddy. Caddy also proxies /api/* to the api service.
FROM node:22-slim AS build

RUN corepack enable
WORKDIR /repo

# Workspace manifests + lockfile first, so dependency install is cached
# independently of source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json biome.json ./
COPY apps/web/package.json apps/web/
COPY packages/dsp/package.json packages/dsp/
RUN pnpm install --frozen-lockfile

COPY apps/web apps/web
# packages/dsp is not a build dependency of @avalab/web yet (Wave 1 adds it);
# when that changes, copy packages/dsp here.
RUN pnpm --filter @avalab/web build

FROM caddy:2-alpine

COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
