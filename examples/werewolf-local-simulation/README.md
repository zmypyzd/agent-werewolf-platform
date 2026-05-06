# Werewolf Local Simulation

In-process end-to-end demo of the multi-agent werewolf platform.
Spins up 9 in-process Fastify mock-agent HTTP servers, wires
`WerewolfHttpAgentAdapter`s into a `WerewolfOrchestrator`, runs
one match, and persists the artifact to `output/matches/<gameId>/`.

## Usage

```bash
pnpm install
pnpm demo:werewolf
# or, equivalently:
pnpm --filter werewolf-local-simulation start
```

Args (positional, optional):

```bash
pnpm demo:werewolf -- <gameId> <seed>
```

Defaults: `<gameId>` = `werewolf-demo-001`, `<seed>` = `werewolf-seed-001`.

## What it produces

```
examples/werewolf-local-simulation/output/
└── matches/
    └── <gameId>/
        ├── manifest.json
        ├── summary.json
        ├── replay.jsonl
        └── decision-trace.jsonl
```

Files match the persisted artifact shape `apps/api/src/routes/werewolf-matches.ts`
serves at `/api/v1/werewolf-matches/:id/...` once a real match has been recorded.

## Reproducibility

Each agent is seeded as `<seed>-<playerId>` so the entire match transcript
is deterministic for a given `<seed>`. Re-run with the same seed to verify
`replayEventCount` and `stepCount` match.
