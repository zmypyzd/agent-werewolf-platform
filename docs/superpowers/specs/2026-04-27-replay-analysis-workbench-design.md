# Replay Analysis Workbench Design

Date: 2026-04-27
Status: Approved for implementation planning

## 1. Summary

Enhance the existing match replay page into a Replay Workbench. The first slice
will make completed match artifacts easier to inspect visually without adding new
backend APIs or changing public artifact privacy guarantees.

The workbench keeps `/matches/:matchId` as the primary route and uses the
existing public artifact endpoints:

- `GET /api/v1/matches/:matchId`
- `GET /api/v1/matches/:matchId/replay`
- `GET /api/v1/matches/:matchId/analysis`

The goal is a more usable local MVP demo surface: a user can open a match, pick a
hand, scan the table state, inspect the action timeline, and understand aggregate
decision behavior from the analysis artifact.

## 2. Goals

- Make the replay page feel like a poker review tool instead of a raw event log.
- Keep all data public-safe: no hole cards, no raw chain-of-thought, no private
  observation text.
- Use only existing match summary, replay event, and analysis summary artifacts.
- Improve the Analysis tab from tables into a compact dashboard with visual
  comparisons.
- Keep the implementation local and static-artifact friendly.

## 3. Non-Goals

- No new scheduled league, ladder, or hosted deployment work.
- No new backend artifact format in this slice.
- No autoplay animation or real-time replay playback.
- No deterministic forensics tags beyond what `analysis-summary.json` already
  exposes.
- No raw JSON payload as the primary viewer surface.

## 4. Page Structure

### 4.1 Header

The header should show the match name, match ID, seed, completion time, hand
count, agent count, and total decision count when analysis is available. The
existing links back to match replays and lobby remain.

### 4.2 Final Stack Strip

Final stacks move from simple text badges into compact stack cards. Each card
shows the agent/player ID and final stack. If hand results are available, the
selected hand can highlight net winners and losers in the hand detail area.

### 4.3 Workbench Replay Tab

The Replay tab becomes a three-zone layout on desktop and a stacked layout on
mobile:

- Left hand rail: one entry per hand, showing hand number, action count,
  community-card count, and biggest absolute net result when available.
- Center hand board: selected hand seed, public community cards, result summary,
  and an ordered action timeline.
- Right inspection panel: selected action details and hand-level context.

The first implementation can select actions from `HandSummary.allActions`. Replay
events remain available as supporting context, but they should not dominate the
main UI. If a selected action cannot be mapped to a decision trace or analysis
record, the panel should state that only aggregate analysis is available.

### 4.4 Action Timeline

Actions should be displayed as stable timeline rows with:

- ordinal position,
- player ID,
- action type,
- amount when greater than zero,
- street/event context when it can be inferred from public replay events.

Selecting a row updates the right inspection panel. Empty hands and loading
states must remain explicit.

### 4.5 Analysis Tab

The Analysis tab keeps the same artifact source but presents it as a dashboard:

- top metric strip for decisions, latency, confidence, timeouts, invalid actions,
  fallbacks, and missing reasoning count,
- action distribution bars,
- intent and risk distribution bars,
- street/action matrix,
- per-agent comparison cards or table with visual bars for decision count,
  latency, timeout, invalid, fallback, and missing reasoning metrics.

Tables may remain where useful, but visual bars and compact metric cards should
carry the page.

### 4.6 Artifact Metadata

Manifest checksum information stays on the page but moves to a low-priority
metadata section. It should not compete with the replay and analysis workbench.

## 5. Data Flow

The page continues to load match metadata, replay events, and analysis summary in
parallel. Derived view models should be local to the web client:

- `HandReplayView`: selected hand plus action count, result summary, community
  card display, and matching replay events.
- `ActionTimelineItem`: stable timeline row derived from `allActions` and public
  event context when available.
- `AnalysisBars`: normalized percentage/value rows derived from
  `MatchAnalysisSummary`.

These derived models should be pure functions where practical so they can be
tested without a browser.

## 6. Privacy And Safety

The UI must not display:

- `holeCards`,
- raw chain-of-thought,
- `keyObservations`,
- `consideredActions.reason`,
- private state snapshots.

The workbench should rely on existing public-safe API responses and avoid adding
client-side affordances that suggest hidden/private data exists in the public
artifact.

## 7. Responsive Behavior

Desktop layout uses the three-zone workbench. Narrow screens should stack:

1. match header and metric summary,
2. hand selector,
3. hand board and action timeline,
4. action inspection panel,
5. artifact metadata.

Controls must keep stable dimensions so selecting hands or actions does not shift
the layout unexpectedly.

## 8. Error And Empty States

- Match load failure shows the existing error and navigation links.
- Replay event failure shows a replay-specific error while keeping match summary
  content visible.
- Analysis load failure shows an analysis-specific error while keeping replay
  usable.
- No hands, no actions, no results, and no analysis are explicit empty states.

## 9. Testing

Add or update web tests to cover:

- Replay Workbench renders the match header and selected hand details.
- Action timeline rows render action type, amount, and player ID.
- Analysis dashboard renders aggregate metrics and agent-level metrics.
- Empty analysis or empty hand data produces clear fallback text.
- API helper behavior for `/matches/:matchId/analysis` remains covered.

Run verification after implementation:

- `pnpm build`
- `pnpm lint`
- `pnpm test`

Some tests bind to localhost and may require running outside the sandbox if the
environment rejects `127.0.0.1` listeners.
