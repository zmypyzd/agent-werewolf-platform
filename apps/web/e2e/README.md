# Playwright e2e (M16)

This folder contains the §12 demo flow as a Playwright happy-path test
(`demo.spec.ts`) plus the launch config (`../playwright.config.ts`).

The dependency is **opt-in** — `@playwright/test` is not in the workspace
install path because Chromium binaries (~150 MB) and the package's many
sub-dependencies are too heavy to fetch reliably in every environment.
The unit + integration suite (`pnpm test`, currently 308 tests) still
covers every cross-stack contract this Playwright test would re-verify;
the e2e exists as the browser-DOM-level pin for the §12 demo.

## Install

```sh
pnpm add -D @playwright/test --filter web
pnpm exec playwright install chromium
```

That should add ~70 MB to `node_modules` plus ~150 MB for the browser
binary in `~/Library/Caches/ms-playwright`.

## Run

```sh
pnpm --filter web run e2e            # headless
pnpm --filter web run e2e -- --headed # visible browser, useful while iterating
pnpm --filter web run e2e -- --ui     # Playwright's interactive runner
```

Playwright launches the api (port 3100) + Vite dev server (port 5174)
itself via the `webServer` array in `playwright.config.ts`. Both servers
run with fresh in-memory state per run; nothing is persisted to disk.

## What the test asserts

1. Two browser contexts (Alice, Bob) register through the UI and land in
   `/lobby`.
2. Alice creates a table; the new row appears in Bob's lobby live (WS).
3. Both navigate to the table and click "Sit here (human)".
4. Alice clicks "Start hand"; both UIs advance via the WS event stream.
5. Each context auto-clicks the first available legal action (check / call
   / fold) until `hand completed` shows up in the action log.
6. Visibility invariant: every WS frame received by either context whose
   topic begins with `table:` is asserted to NOT contain `"holeCards"` —
   this is the same check the backend `ws.test.ts` makes, but at the
   browser level.
