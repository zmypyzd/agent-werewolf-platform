# syntax=docker/dockerfile:1.6
#
# Multi-stage Docker build for the Agent Werewolf Platform API.
# Targets Render / Fly.io / Railway as the deployment surface — any platform
# that runs a long-lived Node.js process and routes a single $PORT.
#
# Build stages:
#   1. base    — pin Node + corepack-enable pnpm @ 10.33.2
#   2. builder — copy monorepo, install all deps, run `pnpm build`
#   3. runner  — copy only the built artifacts + production deps
#
# Image size with the final stage hovers around ~250MB (Node alpine +
# all monorepo dist outputs). For staging that's fine; Phase 4.5 can
# trim further by switching to `pnpm deploy` for a single-package output.

# ─── Stage 1: base ─────────────────────────────────────────────────────
FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
# better-sqlite3 needs python + build tools to compile its native binding.
RUN apk add --no-cache python3 make g++ libc6-compat
WORKDIR /app

# ─── Stage 2: builder ──────────────────────────────────────────────────
FROM base AS builder
# Copy lockfile + workspace manifest first so dependency layers cache
# even when application source changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/agent-protocol/package.json packages/agent-protocol/
COPY packages/agent-runtime/package.json packages/agent-runtime/
COPY packages/auth/package.json packages/auth/
COPY packages/persistence/package.json packages/persistence/
COPY packages/poker-engine/package.json packages/poker-engine/
COPY packages/realtime/package.json packages/realtime/
COPY packages/shared/package.json packages/shared/
COPY packages/table-orchestrator/package.json packages/table-orchestrator/
COPY packages/werewolf-engine/package.json packages/werewolf-engine/
COPY packages/werewolf-orchestrator/package.json packages/werewolf-orchestrator/
COPY examples/local-simulation/package.json examples/local-simulation/
COPY examples/mock-agents/package.json examples/mock-agents/
COPY examples/werewolf-local-simulation/package.json examples/werewolf-local-simulation/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Now copy the rest. Source-only layer so a code change doesn't bust the
# install cache above.
COPY tsconfig.json vitest.workspace.ts ./
COPY apps apps
COPY packages packages
COPY examples examples

RUN pnpm build

# ─── Stage 3: runner ───────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production

# Copy lockfiles + manifests so we can install production-only deps.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/agent-protocol/package.json packages/agent-protocol/
COPY packages/agent-runtime/package.json packages/agent-runtime/
COPY packages/auth/package.json packages/auth/
COPY packages/persistence/package.json packages/persistence/
COPY packages/poker-engine/package.json packages/poker-engine/
COPY packages/realtime/package.json packages/realtime/
COPY packages/shared/package.json packages/shared/
COPY packages/table-orchestrator/package.json packages/table-orchestrator/
COPY packages/werewolf-engine/package.json packages/werewolf-engine/
COPY packages/werewolf-orchestrator/package.json packages/werewolf-orchestrator/

# Production install — drops vitest, typescript-only dev deps, etc.
# Note: better-sqlite3 still needs compile tools, but in runner we
# rebuild from the prebuilt binary downloaded by the package itself.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "api..."

# Copy compiled JS from the builder stage. Per-package dist directories
# are what Node actually loads at runtime (the source TypeScript is not
# needed for execution).
COPY --from=builder /app/apps/api/dist                                 apps/api/dist
COPY --from=builder /app/packages/agent-protocol/dist                  packages/agent-protocol/dist
COPY --from=builder /app/packages/agent-runtime/dist                   packages/agent-runtime/dist
COPY --from=builder /app/packages/auth/dist                            packages/auth/dist
COPY --from=builder /app/packages/persistence/dist                     packages/persistence/dist
COPY --from=builder /app/packages/poker-engine/dist                    packages/poker-engine/dist
COPY --from=builder /app/packages/realtime/dist                        packages/realtime/dist
COPY --from=builder /app/packages/shared/dist                          packages/shared/dist
COPY --from=builder /app/packages/table-orchestrator/dist              packages/table-orchestrator/dist
COPY --from=builder /app/packages/werewolf-engine/dist                 packages/werewolf-engine/dist
COPY --from=builder /app/packages/werewolf-orchestrator/dist           packages/werewolf-orchestrator/dist

# Render and Fly inject the actual port via $PORT. Listen on 0.0.0.0 so
# the platform's reverse proxy can reach the container.
ENV HOST=0.0.0.0
EXPOSE 3000

# /health is wired in apps/api/src/routes/health.ts and never auths. Render
# polls this every 30s after deploy; status 200 marks the deploy live.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/health" || exit 1

CMD ["node", "apps/api/dist/index.js"]
