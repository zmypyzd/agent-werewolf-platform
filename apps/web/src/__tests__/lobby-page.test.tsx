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

function tableRow(html: string, tableName: string): string {
  const row = [...html.matchAll(/<article\b[^>]*class="[^"]*\blobby-table-row\b[^"]*"[^>]*>[\s\S]*?<\/article>/g)]
    .map(match => match[0])
    .find(rowHtml => rowHtml?.includes(tableName));

  expect(row, `Expected row for ${tableName}`).toBeDefined();
  return row!;
}

function expectTableRow(
  row: string,
  expected: {
    status: string;
    players: string;
    spectators: string;
    blinds: string;
    hand: string;
    href: string;
    action: string;
  },
) {
  expect(row).toContain('class="status-chip');
  expect(row).toContain(expected.status);
  expect(row).toContain(expected.players);
  expect(row).toContain(expected.spectators);
  expect(row).toContain(expected.blinds);
  expect(row).toContain(expected.hand);
  expect(row).toContain(`href="${expected.href}"`);
  expect(row).toContain(`>${expected.action}</a>`);
}

describe('LobbyPageContent', () => {
  it('renders table operation rows with status, counts, blinds, hand, and actions', () => {
    const html = renderLobbyContent();
    const alphaRow = tableRow(html, 'Alpha Table');
    const betaRow = tableRow(html, 'Beta Table');

    expectTableRow(alphaRow, {
      status: 'In hand',
      players: '4 / 6',
      spectators: '12 spectators',
      blinds: '25 / 50 ante 5',
      hand: 'hand-42',
      href: '/tables/table-alpha',
      action: 'Join',
    });
    expectTableRow(betaRow, {
      status: 'Preparing',
      players: '6 / 6',
      spectators: '3 spectators',
      blinds: '50 / 100 ante 0',
      hand: 'No hand',
      href: '/tables/table-beta',
      action: 'Watch',
    });
  });

  it('renders loading, empty, and error states', () => {
    expect(renderLobbyContent({ tables: [], loading: true })).toContain('Loading tables');
    expect(renderLobbyContent({ tables: [], loading: false })).toContain('No tables yet');
    expect(renderLobbyContent({ error: 'Failed to load tables' })).toContain('Failed to load tables');
  });
});
