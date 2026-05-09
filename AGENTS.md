# AGENTS.md

This file provides guidance to AI coding agents working in this repository.

## Project Overview

Agent Poker Platform is a pnpm TypeScript monorepo for multi-agent Texas Hold'em
experimentation. It is entertainment and technical research software only. Do
not add real-money gambling, deposits, withdrawals, betting odds, payments, or
financial transaction features.

Runtime expectations:

- Node.js 20 (`.node-version` is `20`; `package.json` requires `>=20 <21`)
- pnpm 10.33.2
- Full ESM across all packages
- Workspace globs: `apps/*`, `packages/*`, `examples/*`

## Auth state (mid-migration)

Two paths coexist; use this table to decide which to follow when touching a route:

| Routes | Auth | Storage |
|---|---|---|
| `/api/v1/agents/invites/*`, `/api/v1/me/agents/*` | Supabase JWT (`Authorization: Bearer …` + `app.requireJwtAuth`) | Postgres `agents` / `agent_invites` under RLS |
| `/api/v1/tables/*`, `/api/v1/werewolf-games/*`, `/api/v1/simulate`, `/api/v1/auth/*` | Cookie session (`apk_sid` + `X-Requested-With: fetch` CSRF) | SQLite (`users`, sessions, `user_agent_configs`) |
| `/api/v1/me/werewolf-agents/*` | Cookie session (legacy) | Postgres `agents` (hybrid: new store, old auth) |
| `/api/v1/agents/invites/:token/register` | Public (no auth) | Postgres (service-role client) |

When adding new authenticated routes, prefer the JWT path. `apps/api/src/routes/auth.ts`
is marked DEPRECATED — it will be deleted once the cookie path retires.

**Test pattern:** inject `authService: new MockAuthService(<any-user-id>)` into
`buildServer()` and send `Authorization: Bearer <any-token-string>` headers — `MockAuthService`
accepts any non-empty bearer and resolves to the constructor user id. Leave
`supabaseConfig` undefined so routes return `501 NOT_IMPLEMENTED` for CRUD calls (auth
gate still verifiable). See `apps/api/src/__tests__/agent-invites.test.ts` and
`route-audit.test.ts` for canonical test setups.

## Common Commands

| Command                 | Purpose                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `pnpm install`          | Install workspace dependencies                                     |
| `pnpm build`            | Sequential `pnpm -r run build` across all packages/apps            |
| `pnpm test`             | Run the Vitest workspace from `vitest.workspace.ts`                |
| `pnpm test:watch`       | Run workspace Vitest in watch mode                                 |
| `pnpm test:coverage`    | Run workspace Vitest with V8 coverage                              |
| `pnpm lint`             | Run `tsc -p tsconfig.json --noEmit` in each package/app; no ESLint |
| `pnpm typecheck`        | Non-blocking build-based TS check with warning/info filtering      |
| `pnpm dev:api`          | Start Fastify API at `http://localhost:3000/api/v1`                |
| `pnpm --filter web dev` | Start the Vite client at `http://localhost:5173`                   |
| `pnpm demo`             | Run the local simulation demo                                      |

Focused commands:

```bash
pnpm --filter @agent-poker/poker-engine run test
pnpm --filter @agent-poker/table-orchestrator run test
pnpm --filter api run test
pnpm exec vitest run path/to/file.test.ts
pnpm exec vitest run -t "test name pattern"
```

API and `table-orchestrator` Vitest configs use a 30s timeout. Web E2E tests are
opt-in: `@playwright/test` is not installed by default; see
`apps/web/package.json` and `apps/web/playwright.config.ts`.

## Repository Layout

```text
packages/
  shared/             Domain types, constants, and AppError classes
  agent-protocol/     Zod schemas for wire types, requests, responses, events
  poker-engine/       Pure Texas Hold'em logic: deck, betting, evaluator, pots
  agent-runtime/      IAgent plus mock/random/HTTP/WS/human agents, NPCs, bootstrap scripts
  auth/               Sessions, cookies, CSRF, passwords, rate limits, Fastify plugin
  persistence/        Memory, file, object-store, and SQLite persistence adapters
  realtime/           RealtimeHub, websocket wire types, subscription filtering
  table-orchestrator/ Table lifecycle, hand runner, orchestrator, scheduled runner
apps/
  api/                Fastify REST + WebSocket API
  web/                React 18 + Vite + react-router-dom client
examples/
  mock-agents/        Example agent implementations
  local-simulation/   CLI demo that writes artifacts to examples/local-simulation/output
docs/                 Product specs, implementation plans, and test plans
```

Do not edit generated `dist/` output. Local demo output and package-manager
stores should stay out of source changes unless the user explicitly asks.

## Architecture Rules

- `poker-engine` is pure logic only: no I/O, no network, no filesystem, no
  `Date.now()`, and no `Math.random()`. Randomness must flow through an injected
  PRNG seed.
- `shared` has zero runtime dependencies. Keep it to types, constants, and error
  classes.
- `agent-protocol` is the source of truth for wire schemas. API routes should
  validate external input through these Zod schemas.
- `persistence` copies `src/sqlite/schema.sql` to `dist/sqlite/schema.sql` in its
  build script. If SQL assets are added, update that build step.
- `apps/api` uses a custom JSON body parser that accepts empty bodies. Do not
  assume default Fastify JSON parsing behavior.
- `apps/api` composes stores and routes in `buildServer()`. Tests often inject
  stores, a `TableOrchestrator`, a `RealtimeHub`, or an auth database.
- Realtime behavior flows through `@agent-poker/realtime` and WebSocket routes;
  preserve public/private event filtering when changing table events.

## API And Auth

API routes are mounted under `/api/v1` except the WebSocket route, which is
proxied by the web app through `/ws`.

Route areas:

- `auth`: register, login, logout, current user session
- `tables`: table CRUD, seats, spectators, human actions, hand history/replay
- `simulate`: local simulation flow and artifact capture
- `matches`: public read-only match artifacts and analysis summaries
- `me-agents`: saved HTTP agent endpoint configurations for a user
- `invites`: owner-created invite tokens plus public token-based agent join flow
- `ws`: realtime table subscriptions
- `health`: service health

Authenticated mutating routes require the session cookie `apk_sid=...` and the
CSRF header `X-Requested-With: fetch`. Public match artifact reads do not require
auth. Invite-token lookup/join routes are public by token and do not require a
session cookie.

## Public-Safe Artifact Boundary

Match artifacts are public read-only resources and must remain scrubbed:

- Match summaries omit private hole cards and private hand evaluations.
- Replay JSONL omits private hole-card events.
- Decision traces store state hashes and bounded `reasoningSummary` only. Never
  store raw chain-of-thought or full private state.
- `analysis-summary.json` is deterministic and aggregate-only, generated from
  public summaries and sanitized traces.
- Trace writes enforce per-trace, per-match byte limits and per-match count
  limits.
- Until a separate match identity is modeled in the runtime, decision traces use
  `tableId` as the temporary `matchId`.

## TypeScript And ESM

- All packages use `"type": "module"`.
- Import paths must include `.js` extensions even when importing TypeScript
  source, for example `import { foo } from './bar.js'` for `bar.ts`.
- `tsconfig.base.json` uses `NodeNext` module resolution, targets ES2022, and
  enables strict mode plus `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`, and `noImplicitOverride`.
- Workspace package names use `@agent-poker/*`. The API app is named `api`; the
  web app is named `web`.
- Prefer exported interfaces/types at package boundaries when they clarify the
  contract.

## Testing Conventions

- Vitest globals are enabled. Do not import `describe`, `it`, or `expect`.
- Test files live in `src/__tests__/` and use `*.test.ts` or `*.test.tsx`.
- Web unit tests run in Vitest and exclude `apps/web/e2e`.
- Playwright E2E starts an API server on port 3100 and a Vite server on port
  5174 when the optional Playwright dependency is installed.
- Add focused tests for poker rules, orchestration flows, auth/session behavior,
  API route validation, persistence changes, and UI behavior touched by a change.

## Style

- Prettier is configured with 2-space indent, single quotes, no semicolons, and
  trailing commas.
- No ESLint is configured. `pnpm lint` is TypeScript checking.
- Use `PascalCase` for React components/classes, `camelCase` for functions and
  variables, and lowercase hyphenated directories.
- Keep route validation and public response shaping close to the route layer.
- Do not import Vitest globals.

## Environment Variables

- `PORT`: API listen port, default `3000`.
- `HOST`: API listen host, default `0.0.0.0`.
- `NODE_ENV`: auth/runtime environment; tests commonly use `test`.
- `API_TARGET`: Vite proxy target for `/api` and `/ws`, default
  `http://127.0.0.1:3000`.
- `MATCH_ARTIFACT_STORE`: `memory`, `file`, or `object`; default `memory`.
- `MATCH_ARTIFACT_BASE_DIR`: required when `MATCH_ARTIFACT_STORE=file`.
- `DATABASE_PATH`: used by `openDatabase()` when a caller does not pass an
  explicit SQLite path.

## Demo Output

`pnpm demo` writes local simulation artifacts under
`examples/local-simulation/output/`:

- `{tableId}/{handId}.summary.json`
- `{tableId}/{handId}.replay.jsonl`
- `matches/{matchId}/manifest.json`
- `matches/{matchId}/summary.json`
- `matches/{matchId}/replay.jsonl`
- `matches/{matchId}/decision-trace.jsonl`
- `matches/{matchId}/analysis-summary.json`

These outputs are for local inspection and should not be treated as source.

## Security

This project is for entertainment and technical research only. Do not add
real-money gambling, deposits, withdrawals, betting odds, payment rails, or
financial transaction features. Keep secrets out of source. Preserve auth,
ownership, CSRF, and public/private data boundaries when changing API behavior.
