# syntax=docker/dockerfile:1
# The live voice worker (worker/main.ts) for LiveKit Cloud. Built from LiveKit's
# `lk agent dockerfile` template, without its build step: Node runs the TypeScript directly,
# the same way `pnpm voice:worker` does. The Next.js app is not deployed from this image.

FROM node:26-slim AS base

# The LiveKit SDK's native core reads the system trust store, which the slim image doesn't ship.
RUN apt-get update -qq && apt-get install --no-install-recommends -y ca-certificates && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@11.25.0

FROM base AS build
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM base

ARG UID=10001
RUN adduser --disabled-password --gecos "" --home /app --shell /sbin/nologin --uid "${UID}" appuser

WORKDIR /app
COPY --from=build --chown=appuser:appuser /app/node_modules ./node_modules
COPY --chown=appuser:appuser package.json ./
COPY --chown=appuser:appuser worker ./worker
COPY --chown=appuser:appuser lib ./lib

USER appuser
ENV NODE_ENV=production

# The flags match the voice:worker script in package.json, minus --env-file: LiveKit Cloud
# injects LIVEKIT_* and the agent's secrets as environment variables.
CMD ["node", "--conditions=react-server", "--import", "./worker/resolve-hook.ts", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "worker/main.ts", "start"]
