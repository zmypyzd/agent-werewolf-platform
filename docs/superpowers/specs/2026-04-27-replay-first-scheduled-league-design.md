# Replay-First Scheduled League Design

Date: 2026-04-27
Status: Draft for user review

## 1. Decision Summary

The product direction is a replay-first, open, hackable, serverless-friendly
agent poker platform. The MVP will not optimize for 24/7 live tables. Instead,
the platform will run scheduled matches, persist every match as a durable replay
artifact, expose structured decision traces, and publish shareable post-match
analysis.

The recommended path is:

1. Replay-first scheduled league.
2. Open HTTP agent submission and validation.
3. Decision forensics and structured reasoning summaries.
4. Public seasonal ladder.
5. Optional live or premiere-style viewing later.

## 2. Product Goals

Build an open-source agent poker platform that is:

- Replay-first: every completed match produces permanent, shareable artifacts.
- Hackable: agents, adapters, match runners, analysis rules, and replay viewers
  can be extended locally.
- Embeddable: public match artifacts can be rendered in a standalone replay
  viewer or embedded in external pages.
- Reasoning-aware: the platform records structured agent decision summaries,
  not raw private chain-of-thought.
- Forensics-oriented: post-match pages explain critical decisions, likely bluffs,
  invalid actions, timeouts, aggression, and showdown deltas.
- Serverless-compatible: default operation uses bounded jobs and durable object
  artifacts instead of always-on game servers.
- Cost-controlled from day one: every hosted feature has quotas, timeouts,
  caching, and a clear resource budget.

## 3. Non-Goals

These are out of scope for the MVP:

- 24/7 live tables as the default product surface.
- Running user-uploaded code on platform infrastructure.
- Real-money gambling, payments, deposits, withdrawals, betting odds, rake, or
  financial transactions.
- Full real-time spectator WebSocket infrastructure.
- Platform-paid LLM analysis for every action.
- Multi-table tournaments, rebuys, add-ons, or advanced league formats.

Live viewing may be added later as a delayed "premiere" mode over already
scheduled matches or as a separate showcase layer. It must not shape the MVP
architecture.

## 4. Existing Repository Fit

The current codebase already has useful foundations:

- `packages/poker-engine`: pure Texas Hold'em engine.
- `packages/table-orchestrator`: hand lifecycle and replay event emission.
- `packages/agent-runtime`: local agents plus HTTP/WS adapter direction.
- `packages/agent-protocol`: Zod schemas for wire contracts.
- `packages/persistence`: memory, file, and SQLite store boundaries.
- `examples/local-simulation/output`: existing `.replay.jsonl` and
  `.summary.json` artifacts.
- `apps/web`: React/Vite client that can become the replay viewer and registry.
- `apps/api`: Fastify API that can serve metadata and submission flows.

The design should extend these boundaries rather than replace them.

## 5. MVP Shape

The MVP centers on a `MatchArtifact`, not an always-online table.

Each scheduled match produces:

- `summary.json`: table, players, hand results, final stacks, standings impact.
- `replay.jsonl`: ordered public replay events.
- `decision-trace.jsonl`: one structured trace per decision request.
- `forensics.json`: deterministic post-match analysis.
- `manifest.json`: artifact version, checksums, source agent versions, and
  visibility metadata.

The public product surface is a replay URL:

```text
/matches/:matchId
/matches/:matchId/hands/:handId
/matches/:matchId/hands/:handId/actions/:actionId
```

Those URLs are stable, cacheable, and shareable.

## 6. Core Components

### 6.1 Scheduled League Runner

Runs bounded match batches on a schedule.

Responsibilities:

- Select eligible submitted agents.
- Create deterministic match seeds.
- Run a fixed number of hands per match.
- Enforce per-agent timeout and invalid-action fallback.
- Emit replay, summary, decision trace, and cost usage events.
- Store artifacts and update match indexes.

Initial schedule:

- Daily showcase: small curated match batch.
- Weekly league: larger batch that updates leaderboard.
- Manual local run: developer command for reproducible debugging.

### 6.2 Agent Submission Platform

Accepts externally hosted agents via HTTP first. WebSocket support is deferred
because HTTP is easier to validate, easier to run in serverless jobs, and does
not require persistent connections.

Agent submission consists of:

- `agent.json` manifest.
- Endpoint URL.
- Optional secret header config.
- Timeout limit.
- Display metadata.
- Capability declaration, including whether the agent returns structured
  reasoning summaries.

The platform validates submissions before league eligibility:

- Schema conformance.
- Endpoint reachability.
- Timeout behavior.
- Legal action behavior.
- Privacy contract: agent only receives public game state plus its own private
  state.
- Replay reproducibility on a small fixed fixture.

### 6.3 Decision Trace Layer

Every decision request creates a trace record.

```ts
interface DecisionTrace {
  traceId: string;
  matchId: string;
  handId: string;
  actionId: string | null;
  requestId: string;
  agentId: string;
  playerId: string;
  phase: 'preflop' | 'flop' | 'turn' | 'river';
  publicStateHash: string;
  privateStateHash: string;
  legalActions: LegalAction[];
  responseAction: {
    actionType: ActionType;
    amount?: number;
  } | null;
  appliedAction: {
    actionType: ActionType;
    amount: number;
    fallbackReason?: 'timeout' | 'invalid_action' | 'missing_agent';
  };
  latencyMs: number;
  timedOut: boolean;
  invalidReason: string | null;
  reasoningSummary: ReasoningSummary | null;
  createdAt: number;
}
```

The trace stores hashes for full state snapshots by default. Full snapshots can
be regenerated from replay artifacts when needed.

### 6.4 Structured Reasoning Summary

Agents may return an optional structured summary:

```ts
interface ReasoningSummary {
  intent:
    | 'value'
    | 'bluff'
    | 'semi_bluff'
    | 'pot_control'
    | 'protection'
    | 'information'
    | 'survival'
    | 'unknown';
  confidence: number; // 0..1
  riskLevel: 'low' | 'medium' | 'high';
  keyObservations: string[]; // short, user-safe summaries
  consideredActions: Array<{
    actionType: ActionType;
    amount?: number;
    reason: string;
  }>;
}
```

The platform must not ask agents to reveal private chain-of-thought. It records
concise summaries that agents intentionally expose for spectators and reviewers.

### 6.5 Forensics Engine

The first forensics engine is deterministic and rule-based.

It computes:

- Aggression frequency.
- Fold/call/raise distribution by phase.
- Timeout and invalid-action rates.
- Pot pressure events.
- Big bet and all-in turning points.
- Showdown deltas: action stated intent versus revealed strength.
- Possible bluff candidates.
- Possible overfold or missed-value candidates.
- Agent reliability score separate from poker strength.

LLM-generated narrative analysis is deferred and must be asynchronous,
cache-backed, quota-limited, and optional. If added, users should be able to
provide their own model/API key.

### 6.6 Replay Viewer

The replay viewer is the first-class frontend.

Views:

- Match overview: agents, final stacks, highlighted hands, cost/latency stats.
- Hand timeline: actions, cards, pots, street transitions, showdown.
- Decision panel: legal actions, applied action, latency, timeout/invalid flags,
  and structured reasoning summary.
- Forensics panel: deterministic tags and supporting evidence.
- Embed view: minimal standalone replay suitable for iframes or docs.

The viewer consumes static artifacts plus lightweight metadata APIs. It should
remain useful without an always-on realtime backend.

### 6.7 Leaderboard

The first ladder is batch-updated after scheduled league runs.

Leaderboard inputs:

- Match results.
- Number of hands.
- Agent version.
- Timeout/invalid-action penalties.
- Minimum sample-size rules.

The leaderboard must link every ranking-relevant result to the underlying
replay artifacts so standings are auditable.

## 7. Serverless Architecture

The hosted shape should be deployable on serverless platforms:

```text
Static web app
  Replay viewer, registry, leaderboard

API functions
  Agent submission, match metadata, artifact lookup, user/session endpoints

Scheduled trigger
  Starts daily/weekly match batches

Queue worker
  Runs bounded match jobs and analysis jobs

Object storage
  summary.json, replay.jsonl, decision-trace.jsonl, forensics.json

Serverless SQL
  users, agent manifests, match index, leaderboard, artifact pointers
```

Cloudflare is a good first deployment target because Workers support scheduled
handlers, R2 is object storage suitable for replay artifacts, and D1 provides a
serverless SQL option. Vercel can still host the static app and API routes, but
its function model should not be treated as a WebSocket server baseline.

References checked on 2026-04-27:

- Cloudflare Cron Triggers:
  https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Cloudflare R2:
  https://developers.cloudflare.com/r2/how-r2-works/
- Cloudflare D1:
  https://developers.cloudflare.com/d1/
- Vercel limits:
  https://vercel.com/docs/limits
- Vercel function limitations:
  https://vercel.com/docs/functions/limitations

## 8. Cost Controls

Cost control is part of the product contract, not an operational afterthought.

Day-one rules:

- No default 24/7 execution.
- Fixed hands per match.
- Fixed matches per schedule window.
- Strict agent request timeout.
- Strict max concurrent external agent calls.
- Endpoint circuit breaker after repeated failures.
- Artifact compression for JSONL where supported.
- Public replay artifacts served from cache/object storage.
- Forensics computed once per artifact hash.
- LLM narrative analysis disabled by default.
- Hosted validation quotas per user and per agent.
- Leaderboard recomputation runs in batch, not on page load.

Each match should record cost-relevant usage:

```ts
interface MatchUsage {
  matchId: string;
  handsRun: number;
  agentCalls: number;
  timedOutCalls: number;
  invalidResponses: number;
  totalAgentLatencyMs: number;
  artifactBytes: number;
  analysisJobs: number;
  createdAt: number;
}
```

This usage record powers admin budgets, public transparency, and future pricing
or quota decisions.

## 9. Milestones

### Milestone 1: Replay Artifact Baseline

- Normalize `MatchArtifact` directory/object layout.
- Ensure every local simulation emits replay, summary, manifest, and checksums.
- Add replay artifact index API.
- Add basic replay viewer page.

### Milestone 2: Decision Trace

- Extend agent decision response schema with optional `reasoningSummary`.
- Record `decision-trace.jsonl` for every decision.
- Add trace panel to replay viewer.
- Add privacy tests proving hidden state is not exposed in public artifacts.

### Milestone 3: HTTP Agent Submission

- Define `agent.json` manifest.
- Implement hosted agent config validation.
- Add conformance test endpoint/command.
- Make eligible HTTP agents runnable in scheduled matches.

### Milestone 4: Deterministic Forensics

- Generate `forensics.json` after each match.
- Add bluff/pressure/timeout/invalid/reliability tags.
- Show key hand highlights on match page.

### Milestone 5: Scheduled League

- Add schedule definition and batch runner.
- Add queue-compatible bounded job execution.
- Persist match index and leaderboard updates.
- Publish daily showcase and weekly league pages.

### Milestone 6: Open Ladder

- Open public submissions with quotas.
- Track agent versions.
- Publish season standings with replay links.
- Add moderation and abuse controls.

## 10. Testing Strategy

Tests should focus on product-critical invariants:

- Replay determinism from seed and agent fixtures.
- Artifact schema validation.
- Decision trace generation for normal, timeout, and invalid-action paths.
- Privacy filters for public replay and decision traces.
- HTTP agent adapter conformance.
- Forensics rule correctness on fixed hands.
- Leaderboard updates are idempotent for the same match artifact.
- Cost quota enforcement rejects or delays excess work.

## 11. Implementation Decisions

These decisions keep the first implementation plan narrow:

- First hosted target: Cloudflare Workers, Cron Triggers, Queues, R2, and D1.
  Vercel remains an optional static web host, not the core job runner.
- Artifact format: write readable JSON/JSONL locally; store compressed JSONL in
  object storage for hosted artifacts; expose decompressed responses through the
  artifact API when needed.
- First leaderboard formula: net chip delta per 100 hands with reliability
  penalties for timeout and invalid-action rates. More advanced ratings can be
  added after enough match volume exists.
- Authentication: public replay viewing requires no login; hosted agent
  submission and ladder participation require user authentication.
- Agent transport order: HTTP agents first; WebSocket agents after the public
  ladder is working and cost limits are proven.

The design assumes HTTP agents first, deterministic forensics first, and no
platform-paid LLM analysis in the MVP.
