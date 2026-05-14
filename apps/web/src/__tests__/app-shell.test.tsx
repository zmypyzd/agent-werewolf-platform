import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { StaticRouter } from 'react-router-dom/server.js';
import { describe, expect, it, vi } from 'vitest';

// Stub the real supabase client BEFORE AppShell (and its transitive deps —
// api.ts, lib/auth.ts) load. Node 20 in this test env doesn't ship native
// WebSocket; the real supabase-js client constructs a RealtimeClient at
// module load and blows up the import. The stub returns the shape AppShell
// + api.ts actually touch: getSession() resolves to no session, and the
// auth-state subscription is a no-op. signOut is a noop too.
vi.mock('../lib/supabase.js', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
      signOut: async () => ({ error: null }),
    },
  },
}));

const { AppShell } = await import('../components/AppShell.js');

function renderShell(currentPath: string): string {
  return renderToStaticMarkup(
    <StaticRouter location={currentPath}>
      <AppShell currentPath={currentPath}>
        <main>Workspace</main>
      </AppShell>
    </StaticRouter>,
  );
}

function cssRules(css: string, selector: string): string[] {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{([^}]*)\\}`, 'g'))]
    .map(match => match[1]!);
}

describe('AppShell (spectator-first shell)', () => {
  it('renders the Agent Arena brand link pointing to /', () => {
    const html = renderShell('/werewolf');
    expect(html).toContain('Agent Arena');
    expect(html).toMatch(/<a[^>]*class="app-brand"[^>]*href="\/"/);
  });

  it('renders no module nav links (lobby/agents/replays/simulate are hidden)', () => {
    const html = renderShell('/werewolf');
    expect(html).not.toMatch(/<nav class="app-nav"/);
    expect(html).not.toContain('href="/lobby"');
    expect(html).not.toContain('href="/agents"');
    expect(html).not.toContain('href="/matches"');
    expect(html).not.toContain('href="/simulate"');
  });

  it('renders the Invite button in the top-right action cluster', () => {
    const html = renderShell('/werewolf');
    expect(html).toContain('app-topbar-actions');
    expect(html).toContain('邀请');
  });

  it('does not show the logout button while the session is still loading', () => {
    const html = renderShell('/werewolf');
    expect(html).not.toContain('登出');
  });

  it('offsets sticky replay side panels below the app topbar', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    const appTopbarRule = cssRules(css, '.app-topbar')[0] ?? '';
    const stickyInspectorRule = cssRules(css, '.action-inspector')
      .find(rule => rule.includes('position: sticky')) ?? '';

    expect(css).toContain('--app-topbar-height: 60px');
    expect(appTopbarRule).toContain('min-height: var(--app-topbar-height)');
    expect(stickyInspectorRule).toContain('top: calc(var(--app-topbar-height) + 16px)');
  });
});
