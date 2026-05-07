import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { WerewolfRoomPage } from '../pages/WerewolfRoomPage.js';

function renderRoom(gameId: string): string {
  return renderToStaticMarkup(
    <StaticRouter location={`/werewolf/${gameId}`}>
      <Routes>
        <Route path="/werewolf/:gameId" element={<WerewolfRoomPage />} />
      </Routes>
    </StaticRouter>,
  );
}

describe('WerewolfRoomPage (SSR smoke)', () => {
  it('renders 9 invite buttons, the back-to-lobby button, and a phase indicator on initial render', () => {
    const html = renderRoom('abc123ef-aa');
    // Header always present.
    expect(html).toContain('狼人杀房间');
    expect(html).toContain('返回大厅');
    // Initial state has 9 empty seats. Plan D3=C — clicking an empty seat
    // opens a popover with "邀请 NPC" / "邀请我的 agent" choices, so the
    // seat itself shows a single "邀请..." entry button rather than the old
    // inline NPC button. Count those instead.
    const inviteButtons = html.match(/邀请\.\.\./g) ?? [];
    expect(inviteButtons.length).toBe(9);
    // Phase indicator shows "等待开局" before any data arrives.
    expect(html).toContain('等待开局');
    // No "开始对局" button until status flips to 'ready' (which requires a server fetch).
    expect(html).not.toContain('开始对局');
  });
});
