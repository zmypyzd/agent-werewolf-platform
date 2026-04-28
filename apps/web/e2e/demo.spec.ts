import { test, expect, type BrowserContext, type Page } from '@playwright/test';

// One end-to-end test driving the §12 demo flow through real browser contexts.
// Two users — Alice (human-vs-human partner) and Bob (drives the agent flow with
// a mock-strategy seat for simplicity, since this test focuses on the UI's
// happy path rather than re-verifying HttpAgentAdapter — that's M11/M6).

const ALICE_EMAIL = `alice-${Date.now()}@e2e.test`;
const BOB_EMAIL = `bob-${Date.now()}@e2e.test`;
const PASSWORD = 'hunter22pw';
const TABLE_NAME = `Demo ${Date.now()}`;

async function registerVia(page: Page, email: string, displayName: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Display name').fill(displayName);
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/lobby/);
}

async function pickFirstAvailableAction(page: Page): Promise<void> {
  // Wait for the action panel to appear (it only renders for the seated user
  // when seat.action_requested arrives over WS).
  const panel = page.locator('text=Your turn').first();
  await expect(panel).toBeVisible({ timeout: 20_000 });
  // Prefer check / call / fold buttons in that order.
  for (const label of [/^check$/i, /^call/i, /^fold$/i]) {
    const button = page.getByRole('button', { name: label }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      return;
    }
  }
  // Fallback to whatever action button is rendered first.
  const anyAction = page.locator('button').filter({ hasText: /fold|check|call|bet|raise|all-in/i }).first();
  await anyAction.click();
}

async function autoPlayUntilHandComplete(page: Page): Promise<void> {
  for (let i = 0; i < 12; i++) {
    // If the action log already shows hand completed, we're done.
    const log = page.locator('ol').first();
    const text = await log.textContent();
    if (text && /hand completed/.test(text)) return;
    // Try to click an action — fail silently if no panel is up (other player's turn).
    const panel = page.locator('text=Your turn').first();
    if (await panel.isVisible().catch(() => false)) {
      await pickFirstAvailableAction(page);
    } else {
      await page.waitForTimeout(400);
    }
  }
  // Final assertion: we want hand.completed to have been logged.
  await expect(page.locator('ol').first()).toContainText('hand completed', { timeout: 10_000 });
}

test('§12 demo — two users sit, hand runs to completion through the UI', async ({ browser }) => {
  const aliceCtx: BrowserContext = await browser.newContext();
  const bobCtx: BrowserContext = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();

  // Capture every WS frame each browser receives, so the visibility-invariant
  // assertion at the end can scan them.
  const aliceFrames: string[] = [];
  const bobFrames: string[] = [];
  alice.on('websocket', ws => {
    ws.on('framereceived', evt => {
      if (typeof evt.payload === 'string') aliceFrames.push(evt.payload);
    });
  });
  bob.on('websocket', ws => {
    ws.on('framereceived', evt => {
      if (typeof evt.payload === 'string') bobFrames.push(evt.payload);
    });
  });

  // Step 1: register both users.
  await registerVia(alice, ALICE_EMAIL, 'Alice');
  await registerVia(bob, BOB_EMAIL, 'Bob');

  // Step 2: Alice creates a table.
  await alice.getByLabel('Name').fill(TABLE_NAME);
  await alice.getByRole('button', { name: /create table/i }).click();
  await expect(alice).toHaveURL(/\/tables\//);
  const tableUrl = alice.url();

  // Step 3: Bob navigates to the same table from his lobby (via the new row).
  await expect(bob.getByText(TABLE_NAME).first()).toBeVisible({ timeout: 10_000 });
  await bob.goto(tableUrl);

  // Step 4: each user sits at the first empty seat they see.
  await alice.getByRole('button', { name: /^sit here$/i }).first().click();
  await bob.getByRole('button', { name: /^sit here$/i }).first().click();

  // Step 5: Alice clicks Start hand — both UIs should advance via the WS stream.
  await alice.getByRole('button', { name: /start hand/i }).click();

  // Step 6: each user auto-plays until the hand completes.
  await Promise.all([
    autoPlayUntilHandComplete(alice),
    autoPlayUntilHandComplete(bob),
  ]);

  // Step 7: visibility invariant — table-topic hole cards are only allowed on
  // explicit reveal frames. Each user's private seat.hole_cards frame is fine
  // and expected.
  function countTableHoleCardRevealFrames(frames: string[]): number {
    let revealCount = 0;
    for (const raw of frames) {
      try {
        const m = JSON.parse(raw) as { topic?: string; type?: string };
        if (typeof m.topic === 'string' && m.topic.startsWith('table:')) {
          if (m.type === 'table.hole_cards_revealed') revealCount += 1;
          if (raw.includes('"holeCards"') && m.type !== 'table.hole_cards_revealed') {
            throw new Error(`unexpected holeCards in table frame: ${raw}`);
          }
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('unexpected')) throw e;
      }
    }
    return revealCount;
  }
  expect(countTableHoleCardRevealFrames(aliceFrames)).toBeGreaterThan(0);
  expect(countTableHoleCardRevealFrames(bobFrames)).toBeGreaterThan(0);

  await aliceCtx.close();
  await bobCtx.close();
});
