import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { describe, expect, it } from 'vitest';
import { AppShell } from '../components/AppShell.js';

// Regression: ISSUE-004 — DESIGN.md mandates a dark "industrial/mysterious"
// surveillance-room aesthetic for the werewolf module, but AppShell unconditionally
// rendered a white poker topbar over the dark werewolf room. The visual seam
// broke the spectator experience.
// Found by /qa on 2026-05-06.
// Report: .gstack/qa-reports/qa-report-localhost-2026-05-06.md

function render(currentPath: string): string {
  return renderToStaticMarkup(
    <StaticRouter location={currentPath}>
      <AppShell currentPath={currentPath} showSimulate>
        <main>page</main>
      </AppShell>
    </StaticRouter>,
  );
}

describe('AppShell werewolf theme modifier', () => {
  it('adds .is-werewolf to the shell on /werewolf', () => {
    const html = render('/werewolf');
    expect(html).toContain('class="app-shell is-werewolf"');
  });

  it('adds .is-werewolf to the shell on /werewolf/:gameId', () => {
    const html = render('/werewolf/abc-123');
    expect(html).toContain('class="app-shell is-werewolf"');
  });

  it('does NOT add .is-werewolf on poker / lobby routes (so other modules stay light)', () => {
    expect(render('/lobby')).toContain('class="app-shell"');
    expect(render('/lobby')).not.toContain('is-werewolf');
    expect(render('/agents')).not.toContain('is-werewolf');
    expect(render('/matches/m-1')).not.toContain('is-werewolf');
    expect(render('/simulate')).not.toContain('is-werewolf');
  });

  it('does NOT bleed the modifier across paths that merely contain "werewolf" mid-string', () => {
    // Defensive: startsWith('/werewolf') means '/lobby?return=/werewolf' should
    // not flip the theme. URL params don't appear in pathname so this is a
    // sanity check.
    expect(render('/agents/werewolf-loving-bot')).not.toContain('is-werewolf');
  });
});
