# VoiceHire cloud voice agent (LiveKit Cloud Agents).
#
# The agent only depends on @livekit/agents, @livekit/rtc-node, zod and dotenv plus its
# own src/, so it is built standalone from this workspace package instead of the repo
# root — LiveKit Cloud packs this directory as the build context.
#
# STT, TTS and the LLM all route through LiveKit's agent gateway, so no third-party
# model keys are baked into the image: they arrive as agent secrets at runtime.

# syntax=docker/dockerfile:1

ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-slim AS base

# ca-certificates: the LiveKit SDK's native Rust core reads the system trust store at
# runtime, which the slim base image does not ship.
RUN apt-get update -qq \
  && apt-get install --no-install-recommends -y ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# --- Build stage ---------------------------------------------------------------
FROM base AS build
WORKDIR /app

# Dependency files first so the install layer is cached across code-only changes.
COPY package.json ./
COPY tsconfig.json ./
# tsx runs the TypeScript entrypoint directly, so dev dependencies are installed too:
# pruning them would remove the runtime itself.
RUN npm install --no-audit --no-fund

COPY src ./src

# --- Production stage ----------------------------------------------------------
FROM base
ARG UID=10001
RUN adduser --disabled-password --gecos "" --home "/app" --shell "/sbin/nologin" --uid "${UID}" appuser

WORKDIR /app
COPY --from=build --chown=appuser:appuser /app /app

USER appuser
ENV NODE_ENV=production

# "start" connects to LiveKit Cloud and waits for dispatched interview jobs.
CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/index.ts", "start"]
