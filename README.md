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
```

Match artifacts are public-safe by default: match summaries omit private hole
cards and hand evaluations, and match replay JSONL omits private hole-card
events. The detail endpoint intentionally does not inline replay events; clients
load the replay stream through `/matches/{matchId}/replay`.

The web client exposes the same artifact at:

```text
http://localhost:5173/matches
http://localhost:5173/matches/{matchId}
```

## Output Locations

- Local per-hand history: `examples/local-simulation/output/{tableId}/{handId}.summary.json`
- Local per-hand replay events: `examples/local-simulation/output/{tableId}/{handId}.replay.jsonl`
- Match artifact manifest: `examples/local-simulation/output/matches/{matchId}/manifest.json`
- Public-safe match summary: `examples/local-simulation/output/matches/{matchId}/summary.json`
- Public-safe match replay events: `examples/local-simulation/output/matches/{matchId}/replay.jsonl`

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
- Scheduled league, ladder, forensics, and decision trace flows are not implemented yet.
- Runtime and match artifact hosting are still mostly local/in-memory.
- The public replay viewer is basic.

## Next Phase Plan

- Decision trace capture and replay inspection.
- HTTP agent submission validation.
- Deterministic forensics for match review.
- Scheduled league runs.
- Open ladder support.
