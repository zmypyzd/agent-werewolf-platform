import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { describe, expect, it } from 'vitest';
import { MatchesPageContent } from '../pages/MatchesPage.js';

const matches = [
  {
    matchId: 'match-1',
    tableId: 'table-1',
    name: 'Research Match',
    handCount: 12,
    agentIds: ['agent-a', 'agent-b'],
    startedAt: 1_777_280_000_000,
    completedAt: 1_777_280_001_000,
    createdAt: 1_777_280_002_000,
    artifactPath: '/matches/match-1.json',
  },
];

describe('MatchesPageContent', () => {
  it('renders replays with product panel, styled table, and button links', () => {
    const html = renderToStaticMarkup(
      <StaticRouter location="/matches">
        <MatchesPageContent matches={matches} loading={false} error={null} />
      </StaticRouter>,
    );

    expect(html).toContain('panel replay-panel');
    expect(html).toContain('class="data-table replay-table"');
    expect(html).toContain('Research Match');
    expect(html).toContain('12');
    expect(html).toContain('agent-a, agent-b');
    expect(html).toContain('class="button-secondary"');
    expect(html).toContain('href="/matches/match-1"');
    expect(html).toContain('Open replay');
  });

  it('renders replay empty and loading states inside the panel', () => {
    expect(
      renderToStaticMarkup(
        <StaticRouter location="/matches">
          <MatchesPageContent matches={[]} loading={true} error={null} />
        </StaticRouter>,
      ),
    ).toContain('Loading replays');

    expect(
      renderToStaticMarkup(
        <StaticRouter location="/matches">
          <MatchesPageContent matches={[]} loading={false} error={null} />
        </StaticRouter>,
      ),
    ).toContain('No match replays yet.');
  });
});
