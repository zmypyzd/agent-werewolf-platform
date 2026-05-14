# Product Evolution Backlog

## Run 2026-05-14 (scout)

Stated product intent extracted:
- **Category:** "Real-time AI vs AI werewolf spectator platform. 9 AI agents play a social deduction game; the UI lets you watch." (`DESIGN.md:4`) + Texas Hold'em poker module on the same monorepo (`CLAUDE.md:7-10`)
- **Persona:** Spectators — explicitly *not* players. "This UI serves **spectators**, not players. There are no human players." (`DESIGN.md:14`); secondary persona "Developers and researchers observing AI agent behavior" (`DESIGN.md:6`).
- **Named analogs:** None. `DESIGN.md`, `docs/agent-poker-werewolf-platform-overview.md`, `README.md`, and `CLAUDE.md` never name a comparison product. That absence is itself a finding (see §1).
- **Non-goals:** "It does **not** support real money gambling, recharge, withdrawal, betting odds, or any financial transactions of any kind." (`README.md:5-8`). Decision-trace forensics, scheduled league, ladder flows explicitly deferred (`README.md:303-308`).
- **Memorable thing:** "Tense & alive — you can feel every vote." (`DESIGN.md:9`)

---

### 1. Premise contradictions

- **The "spectator-first" product ships an admin-form lobby as its landing page**
  - Claim: The default route `/` redirects to `/werewolf`, which renders a heading "Werewolf · 大厅" alongside a prominent **新建游戏** (Create Game) form with `name` / `seed` inputs and a `建局` (Create) submit — the first-paint hero affordance is admin/setup, not "watch a live match." A drive-by spectator who hits the production URL sees a setup form, not a stream.
  - Evidence: `apps/web/src/router.tsx:52` — `{ path: '/', element: <Navigate to="/werewolf" replace /> }`; `apps/web/src/pages/WerewolfLobbyPage.tsx:109-138` renders the create form as a co-equal panel with `<h2 className="ww-section-heading">新建游戏</h2>` and a `建局` button.
  - Stated intent: "This UI serves **spectators**, not players. There are no human players. Design for narrative weight, not for action affordances. Admin controls (create, invite, start) are secondary — the game board is the hero." (`DESIGN.md:14`).
  - Smallest fix: On the `/werewolf` lobby, demote the create-game form into a single secondary CTA (e.g., a small "Host a match" button that opens a modal) and let the running-match list expand into the primary visual zone. Sort the list with `running` first, `completed` second.
  - Why not auto-ship: Reframing the landing hero is a product-taste call: it changes what the founder shows in screenshots, demos, and onboarding. A scout shouldn't pick a hero layout unilaterally.

- **Drop-in spectators have nothing to watch when no match is live**
  - Claim: When `games` is empty, the lobby renders "还没有任何狼人杀对局，先建一个看看" ("No werewolf matches yet — create one and see"). That copy assumes the viewer is an authenticated creator. For the stated spectator persona arriving cold to the URL, the empty state is a dead end with no "watch a past match" path — and `apps/web/src/components/AppShell.tsx:16-21` exposes a `Replays` nav link but it points to `/matches` (poker only).
  - Evidence: `apps/web/src/pages/WerewolfLobbyPage.tsx:83-85` — empty-state copy. `apps/web/src/components/AppShell.tsx:19` — `{ label: 'Replays', href: '/matches', ... }` (poker `/matches`, no werewolf replay route). Confirmed missing: `apps/web/src/router.tsx` has no `/werewolf-matches` route; `docs/overnight-qa-backlog.md:26-30` (CAND-003) explicitly notes "After a werewolf game ends, players have no UI path to revisit the replay or decision traces."
  - Stated intent: "Real-time AI vs AI werewolf spectator platform... the UI lets you watch." (`DESIGN.md:4`) and "the API artifact route already exists; only a viewer is missing" (`docs/agent-poker-werewolf-platform-overview.md:208`).
  - Smallest fix: Add a `/werewolf/replays` (or `/werewolf-matches`) list view that reads `GET /api/v1/werewolf-matches` and surface it on the empty lobby state as "暂无对局 · 看历史对局 →".
  - Why not auto-ship: This is the biggest functional gap implied by the product mission; HANDOFF.md §5 already flagged it as ">200 LOC feature build" and explicitly tagged it "out of overnight-QA scope" — meaning it needs product prioritization, not a tactical patch.

- **The auth wall blocks the spectator persona from the secondary product (poker)**
  - Claim: For the same product whose tagline is "Multi-agent Texas Hold'em poker platform for technical experimentation" (`README.md:3`), every poker route — `/lobby`, `/tables/:id`, `/agents`, `/simulate` — is wrapped in `<ProtectedRoute>` and 302s an anonymous viewer to `/login?next=...`. Only `/matches` and `/matches/:matchId` (replays) are public. So a curious developer cannot watch a live poker hand without registering, even though the same person can watch a live werewolf game with no account.
  - Evidence: `apps/web/src/router.tsx:44-49` — `/lobby`, `/tables/:tableId`, `/agents`, `/agents/new`, `/agents/:agentId/edit`, `/simulate` all wrapped in `<ProtectedRoute>`. Compare `apps/web/src/router.tsx:50-51` — `/werewolf` and `/werewolf/:gameId` deliberately have no `ProtectedRoute`. `apps/web/src/router.tsx:27-30` enforces redirect when neither cookie nor Supabase session is present.
  - Stated intent: "Multi-agent platform for technical experimentation: a Texas Hold'em poker module and a 9-player werewolf module share the same monorepo, agent-runtime, persistence, and realtime hub." (`CLAUDE.md:7-10`) — i.e., these are siblings, not different products. The poker module isn't explicitly described as "spectator-first," but the parallel werewolf decision is the same product family.
  - Smallest fix: Make `/lobby` (poker table list) publicly viewable with read-only chrome; keep mutation endpoints auth-gated server-side as they already are. Match the werewolf pattern.
  - Why not auto-ship: Removing an auth wall is policy-level (account funnel, abuse surface, agent-config exposure) — product taste call.

- **The brand-mark link routes spectators to the auth wall**
  - Claim: The top-bar brand "Agent Arena" link in `AppShell` always points to `/lobby` (the poker lobby, which is auth-gated). Clicking the product logo from `/werewolf` while logged-out sends the user to `/login?next=/lobby` — the brand link punishes the very spectator the product was redesigned around (per PR #49 in recent commits, which made `/werewolf` the new default landing).
  - Evidence: `apps/web/src/components/AppShell.tsx:40` — `<Link to="/lobby" className="app-brand">`. Compare git log `c6f10eb temp: default landing page → /werewolf (instead of /lobby) (#49)` (recent commit) — the root route already moved, but the brand link didn't follow.
  - Stated intent: "This UI serves **spectators**, not players." (`DESIGN.md:14`) and the recent product decision (commit `c6f10eb`) to default-land werewolf-first.
  - Smallest fix: Point `app-brand` to `/` (which redirects to `/werewolf`) instead of `/lobby`. One-line change in `AppShell.tsx:40`.
  - Why not auto-ship: This is a brand-routing call; if poker is the long-term hero, the current link is right. If werewolf is, this is wrong. Needs a product-direction decision, not a code edit.

- **No stated intent for the poker↔werewolf relationship**
  - Claim: `CLAUDE.md` treats poker and werewolf as parallel modules ("share the same monorepo, agent-runtime, persistence, and realtime hub"). `DESIGN.md` describes only werewolf and explicitly scopes itself to "the werewolf module." `README.md`'s title says "Agent Poker Platform" and its first sentence is poker-only. Three documents, three different framings of which game is the product. There is no document declaring whether this is a poker product with a werewolf side-quest, a werewolf product with a poker legacy, or two products under one umbrella.
  - Evidence: `README.md:1-3` ("# Agent Poker Platform / Multi-agent Texas Hold'em poker platform"); `DESIGN.md:2-4` ("# Design System — Werewolf AI Platform"); `CLAUDE.md:5-10` ("Multi-agent platform... poker module and a 9-player werewolf module share the same monorepo"); root brand string "Agent Arena" (`apps/web/index.html:6`, `apps/web/src/components/AppShell.tsx:43`).
  - Stated intent: None — that absence is the finding.
  - Smallest fix: One-paragraph "Product framing" section at the top of `CLAUDE.md` declaring whether the werewolf module is (a) the new flagship, (b) co-equal, or (c) a sandbox; commit `c6f10eb` and PR #48 (Agent Poker → Agent Arena rename) suggest (a) but it's never written down. The downstream decisions (which lobby is the default, where the brand-link points, what `MatchesPage` lists) all flow from this answer.
  - Why not auto-ship: Naming the flagship is the founder's call; getting it wrong wastes follow-up effort.

---

### 2. Frozen assumptions worth re-examining

- `packages/werewolf-orchestrator/src/match-runner.ts` (referenced by `HANDOFF.md:84` and `docs/agent-poker-werewolf-platform-overview.md:62-91`) — "the spectator surface reveals the full roster once the match has started. ... role+side on this event" (intentional per ISSUE-005, locked in by tests).
  - Why this might be wrong now: This was the right call for a developer-debugging dashboard ("you can see who is who and watch them reason"). For the "tense & alive — you can feel every vote" emotional spec in `DESIGN.md:9`, knowing every role from t=0 *removes the tension that the design system was built around*. Twitch-style werewolf streams (the implicit analog, see §4) reveal nothing to the viewer until elimination. Re-examination question: should there be a viewer toggle (or a separate "tournament" mode) where the spectator chooses spoilers-on (researcher view) vs spoilers-off (drama view)?

- `apps/web/src/pages/WerewolfRoomPage.tsx:23-24` — `POLL_WAITING_MS = 2000`, `POLL_RUNNING_MS = 5000`; lobby/room poll the REST endpoint every 2–5s even though SSE already delivers replay events.
  - Why this might be wrong now: The poll is load-bearing for first-paint roster reveal (per `docs/agent-poker-werewolf-platform-overview.md:165-173`) because the WS/SSE topic doesn't replay buffered events. If the API ever gained a "snapshot at subscribe time" pattern, the polling could die — and a polling lobby on Render's free tier is the difference between "warm" and "spin-down." Re-examine whether SSE can serve a snapshot on connect, killing the poll loop.

- `apps/web/src/pages/WerewolfRoomPage.tsx:28-30` — "Auto-dismiss the page-level error banner so a transient invite failure ... doesn't pin a stale red box on the room for the rest of the session. 5s is long enough to read the message".
  - Why this might be wrong now: The comment treats errors as transient. But the only persona reaching this code path is the host who's trying to seat agents — for them, a dismissed error is a silent failure. Re-examine whether errors should be sticky for hosts and auto-dismiss only for the spectator view.

- `apps/web/src/pages/WerewolfLobbyPage.tsx:45-49` — 5-second `setInterval` poll on the lobby `GET /werewolf-games`.
  - Why this might be wrong now: For a spectator product, every viewer of `/werewolf` polls every 5s forever. On Render free tier (~30s cold start, sleeps after 15min idle per `CLAUDE.md:140-150`), one curious viewer leaving the tab open keeps the container hot — convenient for the app, costly when the platform grows past free tier. Re-examine whether the lobby should be SSE-driven (one topic, server-pushes diffs) so 100 spectators don't generate 100 polls/5s.

---

### 3. First-touch friction (persona: spectator, "developers and researchers observing AI agent behavior")

- **The lobby greets a spectator with "Create a game" copy and no live-match preview**
  - Evidence: `apps/web/src/pages/WerewolfLobbyPage.tsx:69-77` — first-paint heading is "Werewolf · 大厅" and the only animation/dynamic element is a `live` count badge in the corner. There is no embedded mini-preview of a running game, no "click here to watch the live match," no "what is this?" copy explaining that AI agents play autonomously. A first-time visitor with no context sees a Chinese-language CRUD form.
  - Smallest fix: When `games.filter(g => g.status === 'running').length > 0`, make the most recently started running game's name + seat count the hero card with a `观战 →` (Watch) button. When zero are running, show a 60-second autoplay reel of a past match's event timeline (or an explainer card).
  - Why not auto-ship: Hero card design is taste; explainer copy is product-voice work.

- **Bilingual UI with no language switch and inconsistent voice**
  - Evidence: `apps/web/src/pages/WerewolfLobbyPage.tsx:71` ("Werewolf · 大厅"), `:82` ("当前游戏"), `:84` ("还没有任何狼人杀对局，先建一个看看"), `:135` ("建局"); compare `apps/web/src/pages/LoginPage.tsx:68-72` (all English). The shell mixes English nav labels (`AppShell.tsx:16-21` — "Lobby", "Agents", "Replays", "Werewolf") with Chinese page bodies inside werewolf. The named persona ("developers and researchers") is global; the product picks one language per page seemingly at random.
  - Smallest fix: Pick one default (mirroring DESIGN.md which is English) and ship a single Chinese override flag (lang query param or browser-locale) if international audience is intentional; otherwise convert werewolf room copy to English to match the shell.
  - Why not auto-ship: Translation choices are product voice; the existing Chinese copy may be deliberate for a CN audience that nobody documented.

- **No "what is this?" surface anywhere on the first paint**
  - Evidence: `apps/web/src/pages/WerewolfLobbyPage.tsx` (full file) contains zero descriptive copy explaining the product. `DESIGN.md:4-9` has perfect tagline material ("Real-time AI vs AI... 9 AI agents play a social deduction game; the UI lets you watch. Tense & alive — you can feel every vote.") that never appears in the product.
  - Smallest fix: Add a one-line subtitle under the H1: "9 AI 代理玩狼人杀 · 你来旁观" (or English equivalent). Three minutes of work; massive context delta for first-touch.
  - Why not auto-ship: Copywriting is taste.

---

### 4. Analog-product gaps (vs. Twitch — derived analog)

The docs name no analog, so deriving one is required (per SKILL.md hard rule). The closest product category is **live spectator stream of AI-vs-AI gameplay** — that's Twitch's "Just Chatting" / "Software & Game Development" niches when AI players are involved, with a structural assist from chess.com's analysis board.

What Twitch does in the same "land on the page" flow:
1. The landing page is a wall of currently-live thumbnails sorted by viewer count.
2. Clicking any thumbnail starts streaming the live content immediately, no signup.
3. A persistent chat rail attaches to every stream.
4. Finished streams become VODs accessible from the channel page.
5. Discoverability: tags, categories, "similar streams."

Diff against current behavior:
- **No thumbnails / no preview**: `WerewolfLobbyPage.tsx:86-106` renders a text list with game name, status pill, "seated count" — no visual of the actual board. A Twitch viewer chooses by thumbnail; here they must click blind. Smallest fix: render a tiny 9-seat arc preview (or a snapshot of `WerewolfPhaseIndicator` state) inside each `<li className="ww-game-row">`.
- **No viewer count**: `WerewolfLobbyPage.tsx:5-11` lobby summary type has `seatedCount` but no `spectatorCount`. Twitch sorts by viewers. Here, popular matches aren't surfaced. Smallest fix: persist `spectatorCount` from the realtime hub's connection count per topic and add it to the summary.
- **No chat / no comment rail**: `WerewolfRoomPage.tsx` and `WerewolfTableSurface.tsx` have no spectator chat affordance. The product's tagline is "you can feel every vote" but spectators have no way to react in real time. Smallest fix: ephemeral chat per match, fan out via the existing SSE plumbing.
- **No VOD surface**: see §1 — `/werewolf` has no "past matches" list, even though `GET /api/v1/werewolf-matches` exists (`apps/api/src/routes/werewolf-matches.ts:1-60`). Smallest fix: add `/werewolf/replays`.
- **No sharing**: a Twitch URL is the unit of social. There's no "share this match" button anywhere in `WerewolfRoomPage.tsx`. A friend cannot be sent a link to a live match with copy. Smallest fix: a clipboard-copy button next to the room title (`WerewolfRoomPage.tsx:172-180`) that copies the deep link.

---

### 5. Surfaces that maybe shouldn't exist

- **`/simulate` page** — `apps/web/src/router.tsx:49` + `apps/web/src/pages/SimulatePage.tsx:199-280`. Lets an authenticated user submit a one-shot poker simulation request. In a spectator-first product (per `DESIGN.md:14`), why does an auth-walled batch-job form exist for *only* the poker module, with no werewolf equivalent? The whole flow can be replaced by the existing `examples/local-simulation` CLI for the developer persona and the lobby for end users. Smallest fix: hide the nav link (`AppShell.tsx:23-27` `simulateNavItem`) behind a feature flag; keep the route for internal use; let the next product cleanup delete the page if no telemetry shows it being used.

- **`/tables/:tableId` live poker view, behind auth** — `apps/web/src/router.tsx:45`. Given the werewolf module proves that a live AI-vs-AI broadcast surface works without auth, the auth-gated poker table view is inconsistent. If poker is meant to remain "join-to-play," fine; if it's actually the same spectator product, this page should split into a public spectator route and an auth-gated seat-claim route. Smallest fix: take a product call (per §1 finding "No stated intent for the poker↔werewolf relationship") before changing anything here.

- **Two `Replays` surfaces, one nav link, none for werewolf** — `apps/web/src/components/AppShell.tsx:19` exposes `Replays → /matches` (poker only) while `docs/agent-poker-werewolf-platform-overview.md:206-209` confirms the werewolf replay UI is missing. The single `Replays` link in the nav misleads users: under werewolf branding, they expect werewolf history. Smallest fix: rename the link to `Poker Replays` and add a separate `Werewolf Replays` once the route exists; or hide the nav link until both modules have replay UIs.

- **The "Agents" nav surface is auth-gated and poker-shaped, but werewolf needs the same UI** — `apps/web/src/router.tsx:46-48` (`/agents`, `/agents/new`, `/agents/:id/edit`) is a poker-era CRUD page. `apps/web/src/pages/AgentEditPage.tsx:125` still says "Configure the endpoint **Agent Poker** calls for decisions" — stale brand copy that contradicts the recent `Agent Arena` rename (PR #48). `docs/overnight-qa-backlog.md:32-35` (CAND-004) confirms there is no werewolf agent-management UI at all; users hit the API directly. Smallest fix: ship a werewolf-agent management UI, *or* re-scope `/agents` as game-agnostic with a game-type filter. Either path implies the page in its current poker-only form shouldn't survive.

- **`Lobby` nav link routes through auth** — `apps/web/src/components/AppShell.tsx:17` — the very first nav item every visitor sees ("Lobby → /lobby") 401s spectators into a login redirect, on a product whose landing page intentionally moved to `/werewolf` for spectator access. If werewolf is the hero, the nav order is upside-down. Smallest fix: reorder so `Werewolf` is first; demote `Lobby` to "Poker (sign in)"; or until the poker↔werewolf product call is made (§1), gate the nav link itself behind auth so anonymous viewers don't see a CTA that punts them.

---

## Run 2026-05-14 (scout, follow-up)

> Second pass on the same day. Skips findings from the first run above; only surfaces premise-level gaps the morning run didn't isolate. Read alongside §1–§5 above — they still stand.

### 1. Premise contradictions

- **The repo's external-facing positioning is still "poker platform," even though every product signal points to werewolf**
  - Claim: The display brand was renamed Agent Poker → Agent Arena (commit `6e68ebd`, PR #48) and the default landing was moved to `/werewolf` (commit `c6f10eb`, PR #49), but the **README** — the canonical surface a curious developer hits on GitHub — still leads with `# Agent Poker Platform` / "Multi-agent Texas Hold'em poker platform" (`README.md:1-3`). Worse, the **invite copy that external contributors literally receive in their onboarding email** still says "You are being invited to **Agent Poker** as an external coding agent" — including for the werewolf module (`apps/web/src/pages/AgentsPage.tsx:533, 621, 675, 695, 734` — 5 separate occurrences). PR #48 was a display-string rename only; the third-party-facing strings (README, invite boilerplate, login subtitle, register subtitle) were missed. A new external contributor's first impression of the product is "Agent Poker", not "Agent Arena."
  - Evidence: `README.md:1-3` ("# Agent Poker Platform / Multi-agent Texas Hold'em poker platform for technical experimentation"); `apps/web/src/pages/AgentsPage.tsx:533` ("You are being invited to **Agent Poker** as an external coding agent for the 9-player WEREWOLF module."); `apps/web/src/pages/LoginPage.tsx:70` ("Continue to your **tables and agent lab**."); `apps/web/src/pages/RegisterPage.tsx:77` ("Create a **player profile for table sessions**.").
  - Stated intent: `apps/web/index.html:6` (`<title>Agent Arena</title>`) and PR #48 commit message "rebrand(web): display name 'Agent Poker' → 'Agent Arena'" — the rebrand intent is recorded; the execution is incomplete.
  - Smallest fix: One-shot sed/Edit pass: README title + first paragraph, `LoginPage.tsx:70` subtitle, `RegisterPage.tsx:77` subtitle, `AgentEditPage.tsx:125`, and the five `AgentsPage.tsx` invite-copy strings. Pure rename, ~10 LOC.
  - Why not auto-ship: The English/Chinese voice of the new positioning is a copywriting call (e.g., "Agent Arena · Watch AI bots play social deduction" vs "Agent Arena · Multi-agent experimentation platform" — different audience cuts). Don't pick the new tagline unilaterally.

- **The end-of-match screen is a dead end — the climax surface drops the spectator with no next action**
  - Claim: When a werewolf match completes, `WerewolfRoomPage` renders a single banner — `🏁 终局：好人胜` or `狼人胜` — and nothing else (`apps/web/src/pages/WerewolfRoomPage.tsx:229-233`). No "watch another live match," no "share this match," no "see how each agent voted," no "view the replay." The room continues to render the dead seats and timeline, but the only navigation affordance is the `返回大厅` (Back to lobby) button in the header (`:177-179`). The product's tagline is "tense & alive — you can feel every vote" (`DESIGN.md:9`) — and the moment the tension resolves, the UI says nothing.
  - Evidence: `apps/web/src/pages/WerewolfRoomPage.tsx:229-233` — the completion banner is a `<div className="ww-banner">` with text only, no follow-up CTAs. Compare with the live-match design intent: the seat surface and timeline persist, so the spectator has visual material to study post-match, but no scaffolding to act on it.
  - Stated intent: The product is positioned as a spectator stream of dramatic AI agent behavior (`DESIGN.md:4-9`). Twitch/YouTube live always presents "watch next" + share + clip at the end of a stream because the moment of completion is when viewer intent is highest.
  - Smallest fix: Under the `🏁 终局` banner, render three CTAs: (a) `观战下一场 →` linking to the most-recently-started running match (or back to the lobby if none); (b) `分享本局` copying the room URL to clipboard; (c) `查看决策日志 →` linking to the (yet-to-build) decision-trace viewer. Even shipping just (a)+(b) — ~30 LOC — closes the dead end.
  - Why not auto-ship: The "watch next" link presupposes a discovery rule (most viewers? most recent? same agent roster?). That's a product-taste call, not a code edit.

- **No "what is this product?" surface for the named secondary persona — first-touch fails for any visitor who doesn't already know what werewolf is**
  - Claim: `DESIGN.md:6` explicitly names the audience as "developers and researchers observing AI agent behavior in a social game context." A developer who has never played werewolf and lands on `/werewolf` sees nine seat cards with role emojis (`👤 / ⚔️ / 🔮 / 💊 / 🏹`), a stream of Chinese phase labels (`🌙 夜 2 / ☀ 白天 / 进入第 N 轮 PK 投票`), and elimination events (`✝ 被狼刀 / 被毒 / 被放逐 / 被开枪`) with no explanation of what the game is, what the roles do, or how to read the board. Grep for any rules/explainer copy anywhere in `apps/web/src/` returns zero hits. The named persona's likely first action — "what am I looking at?" — has no answer.
  - Evidence: Zero matches for "rules", "how to play", "什么是", "规则", "what is this" across `apps/web/src/`. `apps/web/src/werewolf-room/WerewolfTableSurface.tsx:40-54` shows that role labels exist (in `ROLE_LABELS`) but no surface explains what each role *does*. `apps/web/src/werewolf-room/WerewolfEventTimeline.tsx` similarly emits phase events without context.
  - Stated intent: "Developers and researchers observing AI agent behavior in a social game context." (`DESIGN.md:6`) — that audience is broader than "werewolf players who already know the meta."
  - Smallest fix: A `?` icon in `WerewolfPhaseIndicator` (or a fixed-position help badge in `AppShell.tsx`) that opens a modal/drawer with three sections — "What is werewolf?", "Role cheat sheet", "How to read this board." Roughly 80 LOC of content, the rest is one modal component.
  - Why not auto-ship: The explainer content is the founder's product voice (concise vs encyclopedic, Chinese-first vs English-first, sales-pitch vs neutral). Don't write the founder's elevator pitch unilaterally.

- **"Bring your own AI" — the platform's most unique capability — is invisible from every public surface**
  - Claim: `README.md:256-287` documents a substantial external-contributor flow: owners mint invite tokens; external coding agents register an HTTP agent under the owner's account; their agent then plays werewolf in production. That's the differentiating product hook — this isn't just a spectator stream, it's a place for outside developers to *deploy their own AI* into a live arena. But the entire flow is auth-walled at `/agents → Generate invite` (`apps/web/src/pages/AgentsPage.tsx` invite-copy strings) and is reachable only after a viewer (a) finds the Agents nav link (currently the 2nd auth-gated item among 4-5), (b) registers, and (c) lands on the right tab. The werewolf lobby (`WerewolfLobbyPage.tsx`) — the actual landing page — has no `Bring your own agent →` CTA, no `For developers →` link, nothing. The product's most defensible moat is invisible from the front door.
  - Evidence: `apps/web/src/pages/WerewolfLobbyPage.tsx` (full file) — no anchor or button linking to the invite flow; `apps/web/src/components/AppShell.tsx:16-21` — `Agents` is just a nav label, not framed as "Bring your AI"; `README.md:256-287` — the canonical doc on this capability is GitHub-only.
  - Stated intent: `CLAUDE.md:5-10` ("Multi-agent platform for technical experimentation"); the entire `agents-invite` route family in `apps/api/src/routes/` was built specifically for this flow.
  - Smallest fix: One CTA card on the `WerewolfLobbyPage.tsx` empty-state and a `Bring your own AI →` secondary link in the lobby footer pointing to either the existing `/agents` invite tab (if logged in) or to `README.md`'s external-contributor section (if not). ~20 LOC.
  - Why not auto-ship: Promoting the BYOA flow to a primary CTA is a positioning bet — it pivots the product from "watch AI play" to "deploy your AI to play" as the hero affordance. Founder call.

### 2. Frozen assumptions worth re-examining

- `apps/web/src/pages/RegisterPage.tsx:77` — `subtitle="Create a player profile for table sessions."`
  - Why this might be wrong now: The product has no human "players" anymore (`DESIGN.md:14` — "There are no human players"). The register flow's value proposition is shaped by the original poker-as-multiplayer-game framing. Today the only reasons to register are (a) host a werewolf match, (b) generate an invite for an external agent, (c) play the auth-gated poker module. None of those are "table sessions." A new visitor reading this subtitle is being marketed a product that no longer exists.

- `apps/web/src/pages/WerewolfRoomPage.tsx:174-175` — `<h1 className="ww-room-title">狼人杀房间 <span>· {state.gameId.slice(0, 8)}</span></h1>`
  - Why this might be wrong now: Embedding a sliced UUID inside the `<h1>` made sense when the room was a developer dashboard (the gameId is the primary handle for debugging). For the spectator persona it's noise — what they want at the top of the screen is the match `name` field (already set in the lobby form, `WerewolfLobbyPage.tsx:113-122`) and "in-progress / completed" status. Re-examine whether the title should be `{state.name ?? "Live match"}` with the gameId fragment demoted to a `data-testid` or a small monospace caption.

- `apps/web/src/pages/WerewolfLobbyPage.tsx:124-132` — `<input id="ww-seed" placeholder="seed（可选，用于复现）">` rendered as a co-equal field with `name`.
  - Why this might be wrong now: A `seed` is a developer/researcher concept (reproducibility of a random match), not a spectator one. The form treats every visitor of the public `/werewolf` page as a developer who knows what a seed is. Even if the lobby form stays in its current first-class position (see §1 of the morning run), the seed field should retreat into an `<details>Advanced</details>` so 90% of casual visitors aren't confronted with a CS-shaped second input. Re-examination question: does the seed field belong on the casual UI at all, or only on the developer-facing `/agents` / `/simulate` surfaces?

- `apps/web/src/components/AppShell.tsx:16-21` — nav item order: `Lobby, Agents, Replays, Werewolf`.
  - Why this might be wrong now: After PR #49 moved the default landing to `/werewolf`, the navigation order in the chrome still reflects the old poker-first product hierarchy. A spectator lands on werewolf, looks up, sees `Werewolf` as the *last* item in the nav — implying it's a sub-product, not the hero. Either the landing decision is wrong, or this nav order is. Re-examine which is the source of truth.

### 3. First-touch friction (persona: spectator, "developers and researchers observing AI agent behavior")

- **Werewolf-canonical jargon is presented untranslated for non-Chinese / non-werewolf-fluent visitors**
  - Evidence: The room emits Chinese-only labels for cause of death (`apps/web/src/werewolf-room/WerewolfTableSurface.tsx:59-64` — `✝ 被狼刀 / 被毒 / 被放逐 / 被开枪`) and PK-vote copy (`docs/agent-poker-werewolf-platform-overview.md:163` — `进入第 N 轮 PK 投票`). The shell is English (`AppShell.tsx:16-21`), the auth pages are English (`LoginPage.tsx`), the room is Chinese. A research user from outside CN reads the English nav, clicks `Werewolf`, lands in a Chinese stream of game-specific jargon. The named secondary persona ("developers and researchers") is global; the UI assumes CN.
  - Smallest fix: Either (a) add a `lang` query param + per-string lookup (12-20 strings, mostly in `WerewolfTableSurface.tsx`, `WerewolfPhaseIndicator.tsx`, `WerewolfEventTimeline.tsx`); or (b) commit to CN-first audience and convert the shell + auth pages to Chinese for voice consistency. The current half-and-half split is the worst outcome.
  - Why not auto-ship: Localization scope is a strategic product call.

- **The empty seat affordance is `邀请...` ("Invite…") on a spectator-first product**
  - Evidence: `apps/web/src/werewolf-room/WerewolfTableSurface.tsx:202-218` — empty seats render an `<button className="ww-seat-invite">邀请...</button>` button by default. For an anonymous viewer who happens to land on `/werewolf/:gameId` of a `waiting` match (e.g., from a shared link), each empty seat advertises a button that, when clicked, opens an `AgentPickerPopover` they can't use without an account. The popover then shows server errors. A spectator-first UX would either hide the invite affordance entirely for non-owners (matches the `owner` concept that PR #14 introduced) or replace it with a static `empty` chip.
  - Smallest fix: Conditionally pass `onInvite` / `onInviteAgent` only when the viewer is the room creator (the `creatorUserId` field landed in PR #14). The component already supports an optional prop pattern (`WerewolfTableSurface.tsx:233-234`); the gating change is one boolean derived from `state` + the auth session in `WerewolfRoomPage.tsx`.
  - Why not auto-ship: This is "hide a feature based on ownership" — a small but visible UX policy choice (some products *do* let any logged-in user join any open seat); needs an explicit call.

### 4. Analog-product gaps (vs. Twitch — same analog the morning run derived)

- **The post-match scoreboard surface is missing entirely** — Twitch shows post-stream stats (peak viewers, duration, highlights). The werewolf match completes and the surface shows the surviving seats + the cause-of-death badges, but no aggregate stats: how many days/nights elapsed, how many votes were cast, which agent spoke the most, which seat survived the longest. The data is all in the persisted replay artifact (`docs/agent-poker-werewolf-platform-overview.md:113-115`). Smallest fix: a tiny post-match stats footer that reads from the final game state (no new API needed): `9 seats · 4 nights · 3 banishments · Winner: 好人`. ~40 LOC.

- **No "highlights / clips" surface** — Twitch's defining feature for live AI-vs-AI content is the clip: a 30-second moment around an interesting event (a wolf bluff, a seer reveal, a PK tie). The werewolf event timeline already labels every event with a phase + a `sequence` index (`apps/web/src/werewolf-room/werewolfRoomTypes.ts` per `WerewolfReplayEvent`). A "clip from sequence X to Y" + a shareable URL would convert the unique product (AI agents played a wild round) into a sharable artifact. Smallest fix: deferred — needs the replay UI from §1 of the morning run as a precondition; for now, just note this as the natural next product step once `/werewolf/replays` ships.

### 5. Surfaces that maybe shouldn't exist

- **The `seed` form field on the public `/werewolf` lobby** — see §2 above. If kept, it should be hidden behind `Advanced`; if removed, the lobby form becomes a single-field "name + Create" affordance, which softens the "this is a CRUD form" first-paint problem flagged in §3 of the morning run. Either change is small; not making one is the cumulative tell that no spectator-persona product call has been made for the lobby.

- **The pre-built poker-flavored invite copy strings** — `apps/web/src/pages/AgentsPage.tsx:533, 621, 675, 695, 734` hardcodes "Agent Poker" into the boilerplate emails the platform sends to external contributors. PR #48 missed these; they outlive the rename until someone explicitly edits each one. Smallest fix: extract to a single `BRAND_NAME` constant. ~5 LOC. Why this counts as a surface that maybe shouldn't exist *as-is*: emitting "Agent Poker" to external recipients is actively misleading after the rename, and worse, it ships in `werewolf-module invite` strings (533, 695) — i.e., the rebrand failed in exactly the rebrand's stated audience: werewolf onboarding.

