# Design System — Werewolf AI Platform

## Product Context
- **What this is:** Real-time AI vs AI werewolf spectator platform. 9 AI agents play a social deduction game; the UI lets you watch.
- **Who it's for:** Developers and researchers observing AI agent behavior in a social game context.
- **Space/industry:** AI agent experimentation, social deduction games, developer tooling.
- **Project type:** Web app — real-time game spectator dashboard.
- **Memorable thing:** "Tense & alive — you can feel every vote."

## Aesthetic Direction
- **Direction:** Industrial/Mysterious — surveillance-room monitor aesthetic. Like watching an interrogation through one-way glass.
- **Decoration level:** Intentional — no ornamental decoration. Phase-driven color temperature shifts are the atmosphere.
- **Mood:** Heavy, dark, precise. Not cute, not clinical. The board itself is the decoration. Every UI element should increase the sense that something is at stake.
- **Key insight:** This UI serves **spectators**, not players. There are no human players. Design for narrative weight, not for action affordances. Admin controls (create, invite, start) are secondary — the game board is the hero.

## Typography

- **Display/Hero:** `Syne` 800 — geometric, heavy, owns dark UIs without reading as generic. Use for: game title, phase indicator (🌙 夜 2), lobby heading, match name.
  - Load: `https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800`
- **Body/UI:** `DM Sans` — clean, strong tabular-numbers support for vote counts and seat indices. Use for: body copy, nav labels, form text, general UI.
  - Load: `https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700`
- **Agent names / Timeline / IDs:** `JetBrains Mono` — signals "these are machines, not humans." Use for: all agent names (Nova-1, Echo-2), event timeline text, seat IDs (P1–P9), vote counts, status codes, timestamps, seed values.
  - Load: `https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700`
- **Scale:**
  - hero: 48–52px / display: 20–28px / title: 16–18px / body: 14px / label: 12–13px / micro: 10–11px

## Color

- **Approach:** Restrained with semantic phase layers. Color is rare and meaningful — it signals state, not decoration.

```css
:root {
  /* Backgrounds */
  --bg:              #0c0d14;   /* deep blue-black — not flat black */
  --surface:         #13141f;   /* seat cards, panels */
  --surface-el:      #1e2030;   /* elevated surfaces, hover states */
  --surface-hover:   #252840;   /* interactive hover */

  /* Text */
  --text:            #e8e9f0;   /* primary */
  --text-muted:      #5c6278;   /* secondary / labels */
  --text-dim:        #333650;   /* tertiary / timestamps / disabled */

  /* Phase colors — the visual language of the game cycle */
  --day:             #f0a830;   /* amber-gold — daylight, exposed, civic */
  --day-bg:          rgba(240, 168, 48, 0.12);
  --day-border:      rgba(240, 168, 48, 0.28);
  --night:           #7b6fff;   /* display variant of indigo */
  --night-raw:       #5b4aff;   /* primary actions (buttons) */
  --night-bg:        rgba(91, 74, 255, 0.14);
  --night-border:    rgba(91, 74, 255, 0.32);

  /* Player state */
  --alive:           #20c070;   /* surviving player */
  --alive-bg:        rgba(32, 192, 112, 0.10);
  --death:           #e83535;   /* eliminated — sharp, immediate */
  --death-bg:        rgba(232, 53, 53, 0.10);

  /* Structural */
  --border:          rgba(255, 255, 255, 0.06);
  --border-strong:   rgba(255, 255, 255, 0.11);
}
```

- **Dark mode:** This is a dark-first product. There is no light mode.
- **Phase-driven shifts:** When `currentPhase` is a `night-*` phase, apply a radial indigo gradient overlay to the board container. When `day-*`, use an amber-tinted background hint. These shifts are the product's visual identity.

## Spacing
- **Base unit:** 8px
- **Density:** Comfortable — tension comes from color and weight, not cramped layout
- **Scale:** `2px / 4px / 8px / 12px / 16px / 24px / 32px / 48px / 64px`
- **Component padding:** Cards use 8–12px padding. Panels use 16–20px padding.

## Layout
- **Approach:** Grid-disciplined for structure; one risk for the game board.
- **App shell:** Every chrome-having page wraps in `AppShell` — sticky 48px topbar (brand · top-nav · account chip). Fullscreen immersive views (Match Replay fullscreen, Spectator Zen mode) escape the shell. See Component Patterns → App Shell.
- **Game board:** 9 seats in an **oval arc** (not a 3×3 grid). Seats positioned at evenly-spaced angles around an ellipse (rx≈38%, ry≈31% of container). Each seat visually faces the center. Use CSS `position: absolute; transform: translate(-50%, -50%)` with percentage-based `left`/`top`.
- **Room layout:** Under AppShell → MatchMetaStrip (44px, persistent context) → PhaseBanner (60px) → 3-column body: StatsPanel (280px) · BoardWrap (flex) · EventFeed (320px) → AudienceStrip (44px). Total dashboard width up to 1440px.
- **Lobby layout:** Under AppShell → LiveTicker (32px) → HeroCard (16:10, 65% width) + LiveCommentary feed (35%) → SecondaryGames strip (4 compact cards row) → QuickStart bar (64px). Or the simpler 2-column variant: GameList (flex) + CreateMatch (340px) for low-traffic states.
- **Max content width:** 1180px (1440px for game-room dashboard)
- **Border radius:** `sm: 6px / md: 9px / lg: 12px / pill: 9999px`

## Motion
- **Approach:** Intentional — every animation carries meaning.
- **Phase transitions:** When the game transitions to a night phase, the board container fades in an indigo radial overlay (300ms ease-out). Day phase removes it.
- **Deaths:** Seat card fades to 38% opacity and gets a 300ms red border flash before settling.
- **Event timeline:** New entries slide in from bottom (150ms ease-out).
- **Phase badge:** The pulse dot animates at 1.8s interval while a phase is active.
- **Easing:** enter: `ease-out` / exit: `ease-in` / move: `ease-in-out`
- **Duration:** micro: 80ms / short: 150ms / medium: 300ms / long: 500ms
- **No decorative animation** — no loaders, no spinning elements, no entrance animations on static content.

## Component Patterns

### Seat Card
- Width: 80px fixed
- Alive: `border-color: rgba(32, 192, 112, 0.18)`
- Dead: `opacity: 0.38`, `border-color: rgba(232, 53, 53, 0.15)`. Do not remove dead seats — they stay visible.
- Active/speaking: `border-color: rgba(91, 74, 255, 0.55)`, subtle indigo glow.
- Agent names always in `JetBrains Mono`.
- Seat ID (P1–P9) in mono, dimmed color.

### Phase Indicator
- Dominant position: top-center of the room, full-width header bar.
- Large Syne 800 font (20–22px). The phase is the most important information on screen.
- Night: indigo background/border, `--night` color.
- Day: amber background/border, `--day` color.
- Pulsing dot to signal "live."

### Event Timeline
- Monochromatic header: "事件流 · Events" with a live red dot.
- Fixed-height panel, scrolls internally.
- Each entry has a colored left border: night = indigo, day = amber, death = red, vote = dim.
- Timestamps in mono, dimmed. Event text in mono, muted. Highlights (player names, vote counts) use semantic colors.

### Status Pills (Lobby)
- `waiting`: amber background + amber text
- `running`: green background + green text
- `completed`: surface-elevated background + muted text
- `ready`: indigo background + indigo text
- Always `border-radius: 9999px`, `JetBrains Mono`, small (10–11px).

### Buttons
- Primary: `background: var(--night-raw)` (#5b4aff), white text, Syne bold.
- Secondary: `background: var(--surface-el)`, muted text.
- No gradient buttons.

### Form Inputs
- Background: `var(--bg)` (one step darker than container).
- Border: `var(--border)` default, `var(--border-strong)` on focus.
- Font: `JetBrains Mono` — form fields in this product are often machine inputs (seeds, IDs).

### App Shell
- The product chrome. **Already implemented in production at `apps/web/src/components/AppShell.tsx`** — do NOT redesign, only extend.
- Structure: sticky topbar (`.app-topbar`, `--app-topbar-height` ~48px, z-index 20) → page content (`.app-content`).
- Background (werewolf module, `is-werewolf` class on shell): `var(--ww-surface)` topbar, `var(--ww-bg)` page area, bottom border `1px solid var(--ww-border)`.
- Layout: `[Brand left] [flexible content nav middle, optional] [TopbarActions right]`. Padding `0 24px`.
- TopbarActions cluster (right): 邀请 button + 登录/登出 button. Both use `.app-topbar-button` styles. See "Top Bar Actions" below.
- Pages that escape the shell: Match Replay fullscreen, Spectator Zen mode.
- The `is-werewolf` modifier rewrites all surface colors and fonts to the werewolf palette while preserving layout — apply it whenever `currentPath.startsWith('/werewolf')`.

### Brand Identity
- **Product name is "Agent Arena"** — renamed from "Agent Poker" on 2026-05-17 (see git log). The werewolf module is one game inside the Agent Arena product, not a standalone brand.
- Wordmark in `.app-brand`: `[hidden "AA" mark span] [Agent Arena text]`. In the werewolf-themed shell, Syne 800 size `--font-xl` (~20px), `letter-spacing: -0.02em`, color `var(--ww-text)`.
- The "AA" mark is currently `display: none` in production CSS but reserved as the future logo slot (geometric mark). Keep markup so visual branding can switch on later without React changes.
- Click brand → `/` (root). The werewolf lobby is at `/werewolf`, accessed via nav or direct URL.
- The werewolf module never advertises itself as a separate brand. "狼人杀房间 / Werewolf Room" appears as page titles inside the game-room view, NOT in the top brand slot.

### Top Bar Actions (邀请 + Auth)
- The right cluster of the App Shell topbar — `.app-topbar-actions` `display: inline-flex; gap: 8px`.
- **邀请 button** — `.app-topbar-button`, label `邀请`, `aria-haspopup="dialog"`. On click, toggles `<InvitePopover>` anchored beneath it (`.invite-anchor` wrapper).
- **Login/Logout button** — same `.app-topbar-button` style. Renders `登录` when `isLoading` is false and `!user`, `登出` when authed. On `登录` click → `navigate('/login?next=...')`. On `登出` → `signOut()` then `navigate('/', { replace: true })`. Hidden during initial auth-loading state.
- `.app-topbar-button` style: 34px min-height, padding `6px 14px`, `border-radius: 6px`, border `1px solid var(--ww-border)`, background `var(--ww-surface-el)` (`#1e2030`), color `var(--ww-text)`, DM Sans font-weight 600, font-size `--font-sm` (~13px). Hover: bg `var(--ww-surface-hover)`, border `var(--ww-border-strong)`. Focus-visible: `2px solid var(--ww-night-raw)` outline + 2px offset.

### Invite Popover
- Pops down from the 邀请 button. **Already implemented at `apps/web/src/components/InvitePopover.tsx`**.
- Container `.invite-popover`: `position: absolute; top: calc(100% + 6px); right: 0; z-index: 30`. Min-width 200px, padding 6px, border-radius 8px. Background `var(--ww-surface)`, border `1px solid var(--ww-border)`, shadow `0 8px 24px rgba(0, 0, 0, 0.4)` (use heavier shadow on dark theme than the default light-mode `.12`).
- Two action buttons stacked: `邀请 Coding Agent` / `邀请 HTTP Agent`. Class `.invite-popover-action`: full-width, padding `8px 10px`, border-radius 6px, transparent bg, DM Sans 600 `--font-sm`, left-aligned. Hover: bg `var(--ww-surface-hover)`. Disabled (during minting): `opacity: 0.6; cursor: progress;` and label changes to `生成中…`.
- When NOT authed: shows a hint `.invite-popover-hint` at the bottom — `点击后会先登录,登录完成自动复制邀请文案`, color `var(--ww-text-muted)`, font-size `--font-xs`.
- Click outside or Escape → close. Mint flow: POST `/agents/invites` → builds Coding/HTTP boilerplate prompt → writes to clipboard → toasts success. Falls back to manual-copy UI if clipboard write rejects (Safari user-gesture timeout, insecure context).

### Account Chip (optional, future)
- Reserved slot for when we want a richer account affordance than the 登录/登出 button. Spec stays in DESIGN.md for future use; **today's production has just the auth button**.
- Future layout: `[name DM Sans 13px 600] [role pill] [avatar 28px]`. Avatar circle with `linear-gradient(135deg, #5b4aff, #7b6fff)`, initials in Syne 700, green online dot bottom-right.
- Role pills: `ADMIN` (indigo), `USER` (muted), `VIEWER` (alive). When introduced, sits LEFT of the 邀请 button.

### Top Nav (future — not in production today)
- Reserved for when the werewolf module exposes multiple sub-routes (Live / Archive / Agents / Settings).
- Today the werewolf surface is just `/werewolf` (lobby) + `/werewolf/:gameId` (room) — no nav links needed. Adding them is out of scope until there's a third route.
- When added: nav links sit in the topbar between brand and TopbarActions. JetBrains Mono 11px UPPERCASE, gap 24px. Active page uses `.app-nav-link-active` — werewolf module overrides to `color: var(--ww-night)` with night-colored underline.

### Live Ticker
- Realtime scrolling event feed. Always-on signal that "things are happening."
- Height: 32px. Background: `var(--bg)`, bottom border `1px solid var(--border)`.
- Left: 8px red `live-dot` (pulse animation).
- Content: scrolling JetBrains Mono 12px text, `var(--text-muted)`. Match IDs use phase-colored chips (night `#a3f9` indigo, day `#c721` amber).
- Hover: pause scroll.
- Source: SSE `/api/v1/global-ticker`, ringbuffer of last 5 events.

### Match Meta Strip
- 44px bar under App Shell, above PhaseBanner in the Game Room. Always visible while in a match.
- Background: `var(--bg)`. Font: JetBrains Mono throughout (this is machine data).
- Left cluster: `[LIVE pulse pill] [EP-N] [elapsed HH:MM:SS] [ROUND-N indigo pill]`.
- Right cluster: `[seed #...] · [model matchup 3×GPT-4 4×Claude 2×Llama] · [engine vX.Y.Z]`.
- `<strong>` wraps key values in `var(--text)`; everything else in `var(--text-muted)`.
- This is the main cure for the "looks like a demo" pain. Persistent context = persistent product.

### Stats Panel
- Left rail in Game Room body. Width 280px. Background `var(--surface)`. Overflow-y auto.
- Container for multiple `Stat Block`s stacked vertically with dividers (`1px solid var(--border)` between blocks).
- The "tension can be quantified" surface — vote count rising, wolves dropping, speaker timer ticking, kills logged.
- Standard stack order: ALIVE → VOTES CAST → WOLVES REMAINING → SPEAKER (with countdown ring) → RECENT KILLS.

### Stat Block (sub-component)
- One unit of data inside StatsPanel.
- Structure: `label (JBM 10px caps muted)` → `big number (JBM 28px, semantic color) + sub (DM Sans 12px muted)` → optional `bar (6px height, semantic fill)`.
- Semantic color map: `ALIVE → --alive`, `VOTES → --day`, `WOLVES → --death`, `SPEAKER → --night`.
- Speaker variant: replaces the bar with a mini speaker-card (48px ring avatar + countdown timer mono).

### Hero Card
- Top of Lobby, 16:10 ratio, 65% width. Featured live match.
- Background: SVG board thumbnail at 65% opacity + radial phase glow overlay (indigo for night, amber for day).
- Overlay content (z-index 2): `[LIVE pill] [👁 N watching backdrop-blur pill]` → `[match name Syne 36-52px]` → `[JOIN BROADCAST pill CTA — indigo, 32px tall, padded 12×22px, shadow `0 0 32px rgba(91,74,255,.4)`]`.
- Adjacent 35% column: LIVE COMMENTARY feed (scrolling event entries with phase-colored left borders).
- Falls back to plain CTA card when no live match exists.

### Live Commentary
- Companion feed to HeroCard (right 35% column).
- Scrolling event entries each ~50px tall.
- Each entry: `meta line (JBM 10px dim, format: HH:MM:SS · PHASE · 局 #ID)` → `body text (DM Sans 13px muted, agent names highlighted indigo, vote/kill keywords in semantic colors)`.
- Phase-colored 3px left border (night/day/kill).
- Scroll fade gradient at top and bottom edges.

### Game Row
- One row in the Lobby game list. Height 92px (up from 64px — info density is the point).
- Layout: `[64px mini-board thumbnail] [game info column] [WATCH button + watcher count]`.
- Mini-board thumbnail: SVG with 9 seat dots in current live state colors; phase gradient background (indigo for night, amber for day). Dead seats marked.
- Game info column: top row = `[status pill] [game name Syne 700 15px]`; bottom row = `[model matchup mono] · [PN/9 alive mono] · [HH:MM elapsed mono] · [seed #... mono] · [👁 watcher count mono]` (all JetBrains Mono, gap 12px, wrap allowed).
- Hover: border color `var(--border-strong)`.
- Running rows: status pill includes pulse dot. Completed rows: thumbnail at 0.5 opacity.

### Audience Strip
- 44px bar at the bottom of Game Room. The "you're not alone watching" surface.
- Background: `var(--surface)`, top border `1px solid var(--border)`.
- Left: `AUDIENCE · N WATCHING · BROADCAST EP-N` in Syne 700 small caps, letter-spacing 0.08em. Bold N values in `var(--text)`.
- Right: reaction emojis + mono counts (`❤️ 42`, `🔥 28`, `😱 15`, `🐺 9`, `👏 6`), then `+ REACT` link in `var(--night)`.
- Optional: float reaction emojis up from the bottom edge (30s wave) when new reactions arrive.

### Pre-Match Controls (waiting / ready states)
- Visible **only during `state.status === 'waiting'` and `'ready'`**. During live play (`running`/`completed`/`failed`), these affordances disappear — the surface goes spectator-only.
- **Per-seat 邀请...** — `.ww-seat-invite` button rendered on each empty seat card. DM Sans 10px, transparent bg, `1px solid var(--border)` border, padding `3px 6px`, border-radius 4px, color `var(--text-muted)`. Hover: color/border strengthen to `--text`/`--border-strong`. Click opens `<AgentPickerPopover>` (separate from the user-level `<InvitePopover>` — this one invites NPCs or the user's registered agents to seats). Popover is portaled to body to escape `.ww-board-wrapper` overflow clipping.
- **一键邀请 N 个 NPC** — `.ww-fill-npcs` button below the board when `emptySeatCount > 0`. Outlined indigo style: `transparent` bg, `1px solid var(--night-raw)` border + `var(--night-raw)` text, DM Sans 600 13px, padding `9px 22px`, border-radius 8px, centered with `margin: 8px auto`. Hover fills: bg `var(--night-raw)`, color `#fff`. Disabled (during fill request): `opacity: 0.5; cursor: progress;`, label `填充中…`. POSTs to `/werewolf-games/:gameId/fill-with-npcs`.
- **开始对局** — `.ww-start` button visible when `state.status === 'ready'` (all seats filled, awaiting kickoff). Solid indigo: bg `var(--night-raw)`, white text, Syne 700 14px, padding `11px 28px`, border-radius 8px, centered with `margin: 12px auto`. Hover: `opacity: 0.88`. POSTs to `/werewolf-games/:gameId/start`. This is the climactic action — give it more weight than the fill-NPCs button visually (filled > outlined).
- **返回大厅 (Back)** — `.ww-back` button in the room header, top-right. DM Sans, color `var(--text-muted)`, hover `var(--text)`. Lightweight — navigates to `/werewolf`. Always visible (waiting, ready, running, completed).
- **Stacking order:** Per-seat invites on each empty seat → fill-NPCs button below board (waiting only) → 开始对局 button below board (ready only). Both fill and start can appear in sequence as the user moves from "some empty" → "all filled, not started yet".

### Edge States
- The product never shows a raw error string or a blank panel. Every state has a designed shape.

**Empty state.** When a list has no items.
- Centered in the would-be content area.
- Structure: `icon (36px, opacity 0.6)` → `headline (Syne 600 18px)` → `supportive copy (DM Sans 13px muted)` → `primary CTA button`.
- Tone: invite, don't apologize. "还没有任何狼人杀对局" → "先建一个看看，9 个 agent 自动入座一键开战" → `▶ 建立第一局`.

**Loading state.** While data is fetching.
- Skeleton placeholder shape matching the eventual content. Same height, same border-radius.
- Background: `var(--surface-el)` with `linear-gradient(90deg, var(--surface-el) 0%, var(--surface-hover) 50%, var(--surface-el) 100%)` shimmer animating left→right at 1.6s ease-in-out infinite.
- For game rows: 92px tall skeleton with the same 64px thumbnail slot + info area.
- For seat cards: 90×102px skeleton matching seat geometry.
- Never use a generic spinner.

**Error state.** When something failed.
- Red-tinted card: `rgba(232,53,53,.08)` background, `1px solid rgba(232,53,53,.32)` border, `border-radius: 9px`.
- Layout: `[⚠ icon] [error code mono caps + message] [Retry button] [× Dismiss]`.
- Error code is JetBrains Mono 11px uppercase, `var(--death)`. Message is DM Sans 13px `var(--text)`.
- Auto-dismiss after 5s (mirror `ERROR_AUTO_DISMISS_MS` in `WerewolfRoomPage.tsx`).
- Retry button: outline style with death-tinted border and color.

## Information Density Principles

- **Persistent context wins.** Every page that represents a single match must show seed, elapsed time, round number, and matchup composition at all times. The MatchMetaStrip is non-negotiable for game-room.
- **Phase color is information.** Indigo means night, amber means day, red means death. Don't decorate with these colors elsewhere.
- **JetBrains Mono is the "this is real data" signal.** All counts, timestamps, IDs, seeds, model names, agent names use mono. Marketing copy and labels use DM Sans/Syne.
- **Status pills carry weight.** Every collection of items (game rows, seats, agents, events) gets a status pill. A list without status pills reads as a demo.
- **Show the live signal.** Anything ongoing has a 1.8s pulse animation. Anything completed is static. Anything queued is dim.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-06 | Initial design system created | /gstack-design-consultation session. Memorable thing: "tense & alive — you can feel every vote." |
| 2026-05-06 | Oval arc seat layout (not grid) | Matches physical game seating; creates spatial tension; each player visibly faces center |
| 2026-05-06 | Phase-driven color temperature shifts | No other werewolf UI does full-board color shift on phase change; immediate visceral signal |
| 2026-05-06 | JetBrains Mono for agent names | Counterintuitive for a game (usually humanizing fonts) but these are AI agents, not humans |
| 2026-05-06 | Syne as display font | Cabinet Grotesk not on Google Fonts CDN; Syne has same heavy geometric energy |
| 2026-05-06 | Dark-first, no light mode | Spectator tool for developers; dark reduces eye strain; aligns with game atmosphere |
| 2026-05-06 | Admin controls secondary | This is a spectator UI — the board is the hero, not the create/start buttons |
| 2026-05-18 | Extended for product chrome (App Shell, Brand, Top Nav, Account, Ticker, Match Meta Strip, Stats Panel, Hero Card, Game Row, Audience Strip, Edge States) | Leader feedback: "too demo-y, not product-y." Diagnosis: existing system covers the game board well but says nothing about the surrounding product shell. The 11 new patterns extend "tense & alive — you can feel every vote" from the board into every chrome surface. No language change — same fonts, colors, spacing, motion tokens. |
| 2026-05-18 | Amber for active nav (not indigo) | Indigo is reserved for night-phase semantics. Using indigo for nav active state would collide with the phase color system. Amber gives nav its own slot without competing. |
| 2026-05-18 | MatchMetaStrip always visible in Game Room | Persistent context is the main cure for "looks like a demo." Users always knowing what match, what seed, what elapsed time, what model matchup = signals real product, not sandbox. |
| 2026-05-18 | Game rows 92px not 64px | Info density is the point. Each row carries: thumbnail + status + name + model matchup + alive count + elapsed + seed + watcher count. A sparse row reads as demo. |
| 2026-05-18 | Edge states get designed shapes | Empty/Loading/Error each have a defined structure rather than "show this string." Skeletons preserve layout geometry; error cards use semantic red tint; empty states invite via primary CTA. |
| 2026-05-18 | Brand is "Agent Arena" — werewolf is a module inside it | Reflects 2026-05-17 rename from "Agent Poker" to "Agent Arena" (PR #54). The werewolf module is one game inside the broader Agent Arena product; it does not own the top brand slot. `狼人杀房间` appears as page titles inside the room view only. |
| 2026-05-18 | Two distinct "invite" affordances coexist | (1) **Top-bar 邀请** in AppShell → `<InvitePopover>` → mints invite tokens for other people's Coding/HTTP agents (cross-user invite flow). (2) **Per-seat 邀请...** on empty seat cards → `<AgentPickerPopover>` → seats NPCs or your own registered agents (intra-game invite flow). The two never share a button; both stay in production. |
| 2026-05-18 | Pre-Match Controls live in DESIGN.md | Previously the `ww-start` / `ww-fill-npcs` / `ww-seat-invite` buttons were spec-less and easy to overlook in mockup work. Now they're a documented section. Visible only during waiting/ready states. |
