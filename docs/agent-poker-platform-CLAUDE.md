# CLAUDE.md — agent-poker-platform

This file belongs at the **root** of the `agent-poker-platform` project (not inside `docs/`). Copy it to the project root when initializing a new repository.

---

## Project Overview

`agent-poker-platform` is a multi-agent platform for technical experimentation: a Texas Hold'em
poker module and a 9-player werewolf module share the same monorepo,
agent-runtime, persistence, and realtime hub. See
`docs/agent-poker-werewolf-platform-overview.md` for the werewolf
architecture and information-isolation invariants.
Multiple AI agents can join the same table and play No-Limit Texas Hold'em. The platform enforces all game rules, manages hand lifecycle, records history, and provides a REST API.

**This project is for technical experimentation and entertainment only. It does not and must not involve real money, gambling, wagering, or any financial transactions.**

---

## Technology Stack

| Concern | Choice |
|---|---|
| Language | TypeScript 5.5+ (strict mode) |
| Runtime | Node.js 20 LTS |
| Package manager | pnpm 9 |
| Monorepo | pnpm workspaces |
| Test framework | Vitest 2 |
| API framework | Fastify 4 |
| Schema validation | Zod 3 |
| Phase 1 storage | In-memory + JSONL files |
| Phase 2+ storage | PostgreSQL 16 |
| Frontend (Phase 2) | React 18 + Vite 5 |

---

## Directory Structure

```
agent-poker-platform/
├── apps/api/               # Fastify REST API server
├── apps/web/               # React + Vite frontend (Phase 2)
├── packages/shared/        # Domain types, constants, errors
├── packages/agent-protocol/ # Zod schemas for protocol types
├── packages/poker-engine/  # Pure game logic (no I/O)
├── packages/table-orchestrator/ # Hand lifecycle management
├── packages/agent-runtime/ # Agent execution, timeout, adapters
├── packages/persistence/   # Storage abstraction (memory + file)
├── examples/mock-agents/   # Local MockAgent implementations
├── examples/local-simulation/ # CLI demo runner
└── docs/                   # All documentation
```

---

## Build Commands

```bash
pnpm install          # Install all dependencies
pnpm run build        # Build all packages
pnpm run test         # Run all tests
pnpm run test:watch   # Tests in watch mode
pnpm run test:coverage # Tests with coverage
pnpm run lint         # TypeScript type check (tsc --noEmit)
pnpm run dev:api      # Start API dev server
pnpm demo             # Run local simulation demo
pnpm demo:werewolf                                      # werewolf 9-AI simulation, see examples/werewolf-local-simulation
```

---

## Development Rules

### TypeScript

- **Strict mode is mandatory**: `strict: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`.
- **Zero `any` types**: never use `any`. Use `unknown` for genuinely unknown types and narrow with guards.
- **No `// @ts-ignore`**: fix the root cause instead.
- **Module system**: all packages use `"type": "module"` and NodeNext resolution. Imports use `.js` extension even for TypeScript files.
- **No implicit returns**: all functions must explicitly return or be marked `void`.

### Code Style

- No comments explaining what code does. Only comment non-obvious **why** (hidden constraints, workarounds, subtle invariants).
- No docstrings or multi-line comment blocks.
- Function names must be descriptive enough that comments are unnecessary.
- Prefer immutable patterns: functions return new state, they don't mutate.

### Architecture Constraints

1. **`packages/poker-engine` must remain pure**: zero I/O, zero network, zero logging. Only pure functions. Only dependencies: `@agent-poker/shared`. If you need to add I/O to the engine, you are in the wrong package.

2. **Agent adapters must not pollute the game engine**: `packages/agent-runtime` depends on the engine, not the other way. The engine has no knowledge of agents.

3. **`packages/shared` has no runtime dependencies**: only TypeScript types and constants. No zod, no fastify, no nothing. Other packages import from shared.

4. **`packages/agent-protocol` is the Zod validation layer**: it depends on `@agent-poker/shared` and `zod`. Nothing else. All external input validation happens here.

5. **Information isolation**: `AgentDecisionRequest.publicState` must NEVER contain hole cards for any player. `privateState` contains ONLY the requesting agent's hole cards. This invariant must be protected by tests.

---

## Testing Rules

- **Write tests before (or alongside) implementation** — do not implement first and skip tests.
- **Test file location**: `src/__tests__/` within each package, named `*.test.ts`.
- **Every acceptance criterion in `docs/agent-poker-platform-test-plan.md` must have a test**.
- **Run tests before committing**: `pnpm run test` must pass before any commit.
- **Do not mock the poker engine**: integration tests must use the real engine. Only mock I/O (file system, network).
- **Fake timers for timeout tests**: use `vi.useFakeTimers()` for any test involving `TimeoutHandler`.
- **Reproducibility test is mandatory**: at least one test must verify that the same seed produces identical hand history.

---

## Seed and Randomness Rules

- **All deck shuffles must accept a seed string**.
- **Seed construction**: each hand uses seed `${tableConfig.seed}-${handNumber}`.
- **`createSeededRng(seed: string)` is the only source of randomness** in the poker engine. No `Math.random()` anywhere in `packages/poker-engine`.
- **`Math.random()` is allowed** in MockAgents for strategy variation, but not in hand logic.

---

## Security Rules

1. **No real money features**: the following are permanently banned from this codebase:
   - Real-money wagering
   - Currency exchange or conversion
   - Payment processing
   - Deposit, withdrawal, recharge features
   - Odds for real betting markets
   - Any feature that constitutes operating an unlicensed gambling service

2. **External agent isolation (Phase 2+)**: external agent responses must always be validated against `AgentDecisionResponseSchema` before use. Never trust agent input.

3. **Timeout enforcement**: every agent call must go through `TimeoutHandler`. No unbounded agent execution.

4. **Input validation**: all API request bodies validated with Zod before reaching business logic. Never pass raw `req.body` to orchestrator.

---

## Phase Boundaries

### Phase 1 (current) — In scope
- MockAgent-only play
- In-memory + file persistence
- Synchronous hand execution via API
- Local simulation CLI
- No frontend

### Phase 2 — Not yet in scope
- Frontend (React + Vite)
- User accounts and authentication
- PostgreSQL persistence
- HTTP/WS Agent Adapters (currently stubs)
- Real-time WebSocket events

### Never in scope
- Real money
- Gambling features
- Rebuy, tournament, rake

Do not implement Phase 2 features in Phase 1 code. Do not implement out-of-scope features at all.

---

## Adding a New Package

1. Create directory `packages/new-package/`.
2. Add `package.json` with `"name": "@agent-poker/new-package"`, `"type": "module"`, appropriate `dependencies`.
3. Add `tsconfig.json` extending `../../tsconfig.base.json`.
4. Add `vitest.config.ts`.
5. Add `src/index.ts` with public exports.
6. Add to `pnpm-workspace.yaml` (already covered by `packages/*` glob).
7. Add `vitest.workspace.ts` entry (already covered by `packages/*/vitest.config.ts` glob).

---

## File Naming Conventions

- Source files: `kebab-case.ts`
- Test files: `kebab-case.test.ts`
- Class names: `PascalCase`
- Functions and variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Types and interfaces: `PascalCase`
- `examples/local-simulation` writes per-hand and per-match artifacts to `examples/local-simulation/output/...`; those JSON/JSONL files are gitignored.
- `examples/werewolf-local-simulation` writes per-match artifacts to `examples/werewolf-local-simulation/output/matches/<gameId>/`; those JSON/JSONL files are gitignored.

---

## Documentation

All design decisions live in `docs/`. Key files:

| File | Purpose |
|---|---|
| `docs/agent-poker-platform-greenfield-spec.md` | Master specification |
| `docs/agent-poker-platform-implementation-plan.md` | Step-by-step build guide |
| `docs/agent-poker-platform-api-and-protocol.md` | API reference |
| `docs/agent-poker-platform-test-plan.md` | Test cases and acceptance criteria |
| `docs/agent-poker-platform-claude-code-build-prompt.md` | Prompt for fresh Claude Code build |

Do not put design decisions in code comments. Put them in `docs/` or commit messages.
