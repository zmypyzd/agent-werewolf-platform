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
- **Game board:** 9 seats in an **oval arc** (not a 3×3 grid). Seats positioned at evenly-spaced angles around an ellipse (rx≈38%, ry≈31% of container). Each seat visually faces the center. Use CSS `position: absolute; transform: translate(-50%, -50%)` with percentage-based `left`/`top`.
- **Room layout:** 2-column grid — game board (flex 1) + event timeline (fixed 300px width). Phase indicator bar spans full width above both.
- **Lobby layout:** 2-column grid — game list (flex 1) + create-game form (340px).
- **Max content width:** 1180px
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
