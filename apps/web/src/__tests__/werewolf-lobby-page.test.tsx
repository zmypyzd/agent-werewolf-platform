import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { describe, expect, it } from 'vitest';
import { WerewolfLobbyPage } from '../pages/WerewolfLobbyPage.js';

function renderAt(path = '/werewolf'): string {
  return renderToStaticMarkup(
    <StaticRouter location={path}>
      <WerewolfLobbyPage />
    </StaticRouter>,
  );
}

describe('WerewolfLobbyPage (SSR smoke)', () => {
  it('renders the form, heading, and empty-state copy on initial render', () => {
    const html = renderAt();
    expect(html).toContain('Werewolf · 大厅');
    expect(html).toContain('placeholder="局名称（可选）"');
    expect(html).toContain('placeholder="seed（可选，用于复现）"');
    // Empty state since useEffect (api.get) does not run in SSR.
    expect(html).toContain('还没有任何狼人杀对局');
    // The submit button label "建局" must appear.
    expect(html).toMatch(/建局/);
  });
});
