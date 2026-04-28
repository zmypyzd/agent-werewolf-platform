import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { describe, expect, it } from 'vitest';
import { AppShell } from '../components/AppShell.js';

describe('AppShell', () => {
  it('renders the shared navigation without the simulate link by default', () => {
    const html = renderToStaticMarkup(
      <StaticRouter location="/lobby">
        <AppShell currentPath="/lobby">
          <main>Workspace</main>
        </AppShell>
      </StaticRouter>,
    );

    expect(html).toContain('Agent Poker');
    expect(html).toContain('href="/lobby"');
    expect(html).toContain('href="/agents"');
    expect(html).toContain('href="/matches"');
    expect(html).not.toContain('href="/simulate"');
    expect(html).toContain('class="app-shell"');
  });
});
