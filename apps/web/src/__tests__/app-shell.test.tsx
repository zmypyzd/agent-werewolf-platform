import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { StaticRouter } from 'react-router-dom/server.js';
import { describe, expect, it } from 'vitest';
import { AppShell } from '../components/AppShell.js';

function renderShell(currentPath: string, showSimulate = false): string {
  return renderToStaticMarkup(
    <StaticRouter location={currentPath}>
      <AppShell currentPath={currentPath} showSimulate={showSimulate}>
        <main>Workspace</main>
      </AppShell>
    </StaticRouter>,
  );
}

function navLinks(html: string): Array<{ href: string; label: string; className: string; ariaCurrent: string | null }> {
  const nav = html.match(/<nav class="app-nav"[^>]*>([\s\S]*?)<\/nav>/);
  expect(nav).not.toBeNull();

  return [...nav![1]!.matchAll(/<a([^>]*)>([^<]+)<\/a>/g)].map(match => {
    const attrs = match[1]!;
    return {
      href: attrs.match(/href="([^"]+)"/)?.[1] ?? '',
      label: match[2]!,
      className: attrs.match(/class="([^"]+)"/)?.[1] ?? '',
      ariaCurrent: attrs.match(/aria-current="([^"]+)"/)?.[1] ?? null,
    };
  });
}

function cssRules(css: string, selector: string): string[] {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{([^}]*)\\}`, 'g'))]
    .map(match => match[1]!);
}

describe('AppShell', () => {
  it('renders the shared navigation without the simulate link by default', () => {
    const html = renderShell('/lobby');
    const links = navLinks(html);

    expect(html).toContain('Agent Poker');
    expect(links.map(link => [link.label, link.href])).toEqual([
      ['Lobby', '/lobby'],
      ['Agents', '/agents'],
      ['Replays', '/matches'],
    ]);
    expect(html).not.toContain('href="/simulate"');
    expect(html).toContain('class="app-shell"');
  });

  it('marks the matching nav item active independently from the brand link', () => {
    const links = navLinks(renderShell('/agents/new'));
    const agentsLink = links.find(link => link.label === 'Agents');
    const lobbyLink = links.find(link => link.label === 'Lobby');

    expect(agentsLink).toMatchObject({
      href: '/agents',
      ariaCurrent: 'page',
    });
    expect(agentsLink?.className.split(/\s+/)).toContain('app-nav-link-active');
    expect(lobbyLink?.ariaCurrent).toBeNull();
    expect(lobbyLink?.className.split(/\s+/)).not.toContain('app-nav-link-active');
  });

  it('renders simulate navigation only when enabled', () => {
    expect(navLinks(renderShell('/lobby')).some(link => link.href === '/simulate')).toBe(false);
    expect(navLinks(renderShell('/simulate', true)).map(link => [link.label, link.href])).toContainEqual([
      'Simulate',
      '/simulate',
    ]);
  });

  it('marks simulate active when the route is enabled', () => {
    const links = navLinks(renderShell('/simulate', true));
    const simulateLink = links.find(link => link.label === 'Simulate');
    const replaysLink = links.find(link => link.label === 'Replays');

    expect(simulateLink).toMatchObject({
      href: '/simulate',
      ariaCurrent: 'page',
    });
    expect(simulateLink?.className.split(/\s+/)).toContain('app-nav-link-active');
    expect(replaysLink?.ariaCurrent).toBeNull();
    expect(replaysLink?.className.split(/\s+/)).not.toContain('app-nav-link-active');
  });

  it('adds a poker arena HUD to table routes without showing it on ordinary pages', () => {
    const tableHtml = renderShell('/tables/table-1');
    const lobbyHtml = renderShell('/lobby');
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(tableHtml).toContain('class="app-shell app-shell-table-arena"');
    expect(tableHtml).toContain('aria-label="Arena status"');
    expect(tableHtml).toContain('arena-topbar-hud');
    expect(tableHtml).toContain('24ms');
    expect(tableHtml).toContain('Play chips');
    expect(tableHtml).toContain('125,880');
    expect(lobbyHtml).not.toContain('arena-topbar-hud');

    expect(cssRules(css, '.app-shell-table-arena .app-topbar')[0]).toContain('grid-template-columns: minmax(220px, auto) 1fr auto');
    expect(cssRules(css, '.arena-topbar-hud')[0]).toContain('display: flex');
  });

  it('keeps the arena topbar out of the game surface after scrolling', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    const arenaTopbarRule = cssRules(css, '.app-shell-table-arena .app-topbar')[0] ?? '';

    expect(arenaTopbarRule).toContain('position: static');
    expect(arenaTopbarRule).toContain('z-index: 1');
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
