import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';
import { LobbyPageContent, type TableSummary } from '../pages/LobbyPage.js';

const tables: TableSummary[] = [
  {
    tableId: 'table-alpha',
    tableName: 'Alpha Table',
    status: 'in_hand',
    seatedCount: 4,
    maxSeats: 6,
    spectatorCount: 12,
    blinds: { smallBlind: 25, bigBlind: 50, ante: 5 },
    canSit: true,
    currentHandId: 'hand-42',
  },
  {
    tableId: 'table-beta',
    tableName: 'Beta Table',
    status: 'preparing',
    seatedCount: 6,
    maxSeats: 6,
    spectatorCount: 3,
    blinds: { smallBlind: 50, bigBlind: 100, ante: 0 },
    canSit: false,
    currentHandId: null,
  },
];

function renderLobbyContent(props: Partial<ComponentProps<typeof LobbyPageContent>> = {}): string {
  return renderToStaticMarkup(
    <StaticRouter location="/lobby">
      <LobbyPageContent
        tables={tables}
        loading={false}
        error={null}
        onCreate={() => undefined}
        {...props}
      />
    </StaticRouter>,
  );
}

describe('LobbyPageContent', () => {
  it('renders table operation rows with status, counts, blinds, hand, and actions', () => {
    const html = renderLobbyContent();

    expect(html).toContain('Alpha Table');
    expect(html).toContain('class="status-chip');
    expect(html).toContain('In hand');
    expect(html).toContain('4 / 6');
    expect(html).toContain('12 spectators');
    expect(html).toContain('25 / 50 ante 5');
    expect(html).toContain('hand-42');
    expect(html).toContain('href="/tables/table-alpha"');
    expect(html).toContain('Join');

    expect(html).toContain('Beta Table');
    expect(html).toContain('Preparing');
    expect(html).toContain('6 / 6');
    expect(html).toContain('3 spectators');
    expect(html).toContain('50 / 100 ante 0');
    expect(html).toContain('No hand');
    expect(html).toContain('href="/tables/table-beta"');
    expect(html).toContain('Watch');
  });

  it('renders loading, empty, and error states', () => {
    expect(renderLobbyContent({ tables: [], loading: true })).toContain('Loading tables');
    expect(renderLobbyContent({ tables: [], loading: false })).toContain('No tables yet');
    expect(renderLobbyContent({ error: 'Failed to load tables' })).toContain('Failed to load tables');
  });
});
