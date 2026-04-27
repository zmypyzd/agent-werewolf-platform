# Agent Poker Platform

Multi-agent Texas Hold'em poker platform for technical experimentation.

> **IMPORTANT**: This platform is for entertainment and technical research only.
> It does **not** support real money gambling, recharge, withdrawal, betting odds,
> or any financial transactions of any kind.

## Quick Start

```bash
pnpm install
pnpm build
pnpm test
pnpm demo
```

## Installation

Requires Node.js 20 LTS and pnpm 10.33.2.

```bash
pnpm install
```

## Commands

| Command | Description |
|---|---|
| `pnpm build` | Compile all packages and apps |
| `pnpm test` | Run all unit and integration tests |
| `pnpm typecheck` | Build-based TypeScript check with warning/info filtering |
| `pnpm dev:api` | Start Fastify API server (dev mode) |
| `pnpm --filter web dev` | Start Vite web client |
| `pnpm demo` | Run local simulation (5 hands, 4 agents) |
| `pnpm demo:local` | Alias for demo |

## Running Tests

```bash
pnpm test                                              # all tests
pnpm --filter @agent-poker/poker-engine run test      # engine only
pnpm --filter @agent-poker/table-orchestrator run test # orchestrator only
pnpm --filter api run test                             # API only
```

## Running the Demo

```bash
pnpm demo
# or with custom args: numHands seed
# numHands is capped at 20 for the cost-controlled MVP
pnpm --filter local-simulation start -- 5 demo-seed-001
```

Demo output:
- Per-hand summaries: `examples/local-simulation/output/{tableId}/{handId}.summary.json`
- Per-hand replay events: `examples/local-simulation/output/{tableId}/{handId}.replay.jsonl`
- Match artifact manifest: `examples/local-simulation/output/matches/{matchId}/manifest.json`
- Match summary: `examples/local-simulation/output/matches/{matchId}/summary.json`
- Match replay events: `examples/local-simulation/output/matches/{matchId}/replay.jsonl`
- Match decision traces: `examples/local-simulation/output/matches/{matchId}/decision-trace.jsonl`

## Starting the API

```bash
pnpm dev:api
# API available at http://localhost:3000/api/v1
```

## Example API Calls

These mutation examples are schematic request shapes, not standalone
copy-paste commands. Table and simulation mutation routes require a login
session cookie, such as `Cookie: apk_sid=...`, and the
`X-Requested-With: fetch` header. The public replay artifact API below does not
require authentication.

```json
{
  "createTable": {
    "method": "POST",
    "path": "/api/v1/tables",
    "headers": {
      "Content-Type": "application/json",
      "Cookie": "apk_sid=...",
      "X-Requested-With": "fetch"
    },
    "body": {
      "name": "Test",
      "maxSeats": 6,
      "blindConfig": { "smallBlind": 25, "bigBlind": 50, "ante": 0 },
      "seed": "my-seed"
    }
  },
  "addMockAgent": {
    "method": "POST",
    "path": "/api/v1/tables/{tableId}/agents",
    "headers": {
      "Content-Type": "application/json",
      "Cookie": "apk_sid=...",
      "X-Requested-With": "fetch"
    },
    "body": {
      "name": "Bot1",
      "adapterType": "mock",
      "strategy": "random",
      "buyIn": 1000
    }
  },
  "startHand": {
    "method": "POST",
    "path": "/api/v1/tables/{tableId}/hands/start",
    "headers": {
      "Cookie": "apk_sid=...",
      "X-Requested-With": "fetch"
    }
  },
  "runSimulation": {
    "method": "POST",
    "path": "/api/v1/simulate",
    "headers": {
      "Content-Type": "application/json",
      "Cookie": "apk_sid=...",
      "X-Requested-With": "fetch"
    },
    "body": {
      "name": "Sim",
      "maxSeats": 6,
      "blindConfig": { "smallBlind": 25, "bigBlind": 50, "ante": 0 },
      "seed": "sim-seed",
      "agents": [
        { "name": "B1", "strategy": "random", "buyIn": 1000 },
        { "name": "B2", "strategy": "always-call", "buyIn": 1000 },
        { "name": "B3", "strategy": "aggressive", "buyIn": 1000 },
        { "name": "B4", "strategy": "always-fold", "buyIn": 1000 }
      ],
      "numHands": 5
    }
  }
}
```

## Replay Artifact API

Match replay artifacts are public read-only resources:

```bash
# List match artifacts
curl http://localhost:3000/api/v1/matches

# Read one match artifact manifest + summary
curl http://localhost:3000/api/v1/matches/{matchId}

# Read replay events only
curl http://localhost:3000/api/v1/matches/{matchId}/replay

# Read decision traces only
curl http://localhost:3000/api/v1/matches/{matchId}/decision-trace

# Read deterministic analysis summary only
curl http://localhost:3000/api/v1/matches/{matchId}/analysis
```

Match artifacts are public-safe by default: match summaries omit private hole
cards and hand evaluations, and match replay JSONL omits private hole-card
events. Decision trace JSONL stores state hashes and bounded reasoning summaries,
not full private state or raw chain-of-thought. Analysis summary JSON stores
bounded aggregate decision statistics only; it does not include observation text,
considered-action reasons, private cards, or raw chain-of-thought. The detail
endpoint intentionally does not inline replay events, decision traces, or
analysis summaries; clients load those resources through
`/matches/{matchId}/replay`, `/matches/{matchId}/decision-trace`, and
`/matches/{matchId}/analysis`.

### Serverless Artifact Storage

The replay artifact layer is provider-neutral. API routes depend on
`IMatchArtifactStore`, and durable object storage is accessed through
`IObjectStore`.

Current storage modes:

- `memory`: default for tests and local API startup; artifacts reset on restart.
- `file`: local filesystem-backed object store for durable local development.
- `object`: object-store backed match artifact store for injected serverless adapters.

Environment variables:

- `MATCH_ARTIFACT_STORE=memory|file`
- `MATCH_ARTIFACT_BASE_DIR=./artifact-data` when `MATCH_ARTIFACT_STORE=file`

No Cloudflare, Vercel, or S3 SDK is required for this milestone. Future provider
adapters should implement `IObjectStore`.

### Decision Trace Boundary

The analysis layer has a first-stage public-safe decision trace boundary:

- Agent decisions may include an optional bounded `reasoningSummary`.
- Reasoning summaries are structured for replay/review and must not contain raw
  chain-of-thought.
- `IDecisionTraceStore` persists sanitized `DecisionTrace` JSONL records.
- Match artifacts include a deterministic `analysis-summary.json` generated
  from public match summaries and public-safe decision traces.
- Memory and `IObjectStore`-backed implementations are available, so local
  memory/file usage and future serverless object stores share the same boundary.
- Trace writes enforce per-trace, per-match byte limits and per-match count
  limits.
- The hand runtime records traces for normal decisions, timeouts, invalid
  actions, and missing-agent fallbacks.

Until a separate match identity is modeled in the runtime, decision traces use
`tableId` as the temporary `matchId`.

The web client exposes the same artifact at:

```text
http://localhost:5173/matches
http://localhost:5173/matches/{matchId}
```

The match detail view includes replay and analysis tabs. The analysis tab reads
the public `analysis-summary.json` artifact through
`/api/v1/matches/{matchId}/analysis`.

## Output Locations

- Local per-hand history: `examples/local-simulation/output/{tableId}/{handId}.summary.json`
- Local per-hand replay events: `examples/local-simulation/output/{tableId}/{handId}.replay.jsonl`
- Match artifact manifest: `examples/local-simulation/output/matches/{matchId}/manifest.json`
- Public-safe match summary: `examples/local-simulation/output/matches/{matchId}/summary.json`
- Public-safe match replay events: `examples/local-simulation/output/matches/{matchId}/replay.jsonl`
- Public-safe match decision traces: `examples/local-simulation/output/matches/{matchId}/decision-trace.jsonl`
- Public-safe match analysis summary: `examples/local-simulation/output/matches/{matchId}/analysis-summary.json`

## Architecture

```
packages/
  shared/           - Domain types, constants, errors
  agent-protocol/   - Zod schemas for all wire types
  poker-engine/     - Pure Texas Hold'em logic (no I/O)
  agent-runtime/    - IAgent interface, MockAgents, timeout
  auth/             - Login/session primitives and route protection
  persistence/      - MemoryStore + FileStore
  realtime/         - WebSocket/event broadcasting primitives
  table-orchestrator/ - Hand lifecycle, Table, Orchestrator
apps/api            - Fastify REST API, auth-protected mutations, public replay artifacts
apps/web            - React/Vite client with match list and replay views
examples/mock-agents - RandomAgent, AlwaysCallAgent, etc.
examples/local-simulation - CLI demo script
```

## Current Limitations

- Hosted serverless deployment is not implemented yet.
- Decision trace replay UI, forensics, scheduled league, and ladder flows are not implemented yet.
- Runtime and match artifact hosting are still mostly local/in-memory.
- Hosted serverless bindings are not implemented yet; this milestone provides
  the provider-neutral persistence boundary and local object-store adapter.
- Scheduled matches have a local runner boundary but no hosted cron integration yet.
- The public replay viewer is basic.

## Next Phase Plan

- Decision trace capture and replay inspection.
- HTTP agent submission validation.
- Deterministic forensics for match review.
- Scheduled league runs.
- Open ladder support.
