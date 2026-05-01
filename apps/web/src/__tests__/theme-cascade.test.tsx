// Theme cascade regression test (PR1 Task A commit 8 — Layer 1 per
// codex challenge #2 split). Vitest environment is 'node' in this
// project (Risk #11), so this layer asserts CSS-rule presence only.
//
// Layer 2 (Playwright e2e in apps/web/e2e/theme.spec.ts, opt-in) covers
// actual computed-value flips in a real browser.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('theme cascade wiring', () => {
  it('declares an [data-theme="arena"] override block in styles.css', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    const match = css.match(/\[data-theme="arena"\]\s*\{([^}]+)\}/);
    expect(match).not.toBeNull();

    const block = match![1]!;
    expect(block).toMatch(/--surface-page:\s*#0[0-9a-f]{5}/i);
    expect(block).toMatch(/--text-primary:\s*#[ef][0-9a-f]{5}/i);
    expect(block).toMatch(/--accent-primary:/);
  });

  it('TablePage source contains the dataset.theme effect with cleanup', () => {
    const tablePage = readFileSync(
      new URL('../pages/TablePage.tsx', import.meta.url),
      'utf8',
    );
    expect(tablePage).toMatch(/document\.documentElement\.dataset\.theme\s*=\s*['"]arena['"]/);
    expect(tablePage).toMatch(/delete document\.documentElement\.dataset\.theme/);
  });
});
