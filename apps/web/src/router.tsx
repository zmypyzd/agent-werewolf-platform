import { Navigate, createBrowserRouter, useLocation } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './auth/AuthContext.js';
import { useSession } from './lib/auth.js';
import { AppShell } from './components/AppShell.js';
import { LoginPage } from './pages/LoginPage.js';
import { RegisterPage } from './pages/RegisterPage.js';
import { LobbyPage } from './pages/LobbyPage.js';
import { TablePage } from './pages/TablePage.js';
import { AgentsPage } from './pages/AgentsPage.js';
import { AgentEditPage } from './pages/AgentEditPage.js';
import { MatchesPage } from './pages/MatchesPage.js';
import { MatchReplayPage } from './pages/MatchReplayPage.js';
import { SimulatePage } from './pages/SimulatePage.js';
import { WerewolfLobbyPage } from './pages/WerewolfLobbyPage.js';
import { WerewolfRoomPage } from './pages/WerewolfRoomPage.js';

function ProtectedRoute({ children }: { children: ReactNode }) {
  // Accept EITHER a cookie session (legacy useAuth) OR a Supabase JWT session.
  // During the auth migration, both paths coexist; either signal counts as
  // logged-in. Once cookie auth is fully retired, the useAuth() branch goes.
  const { user: cookieUser, loading: cookieLoading } = useAuth();
  const { user: supabaseUser, isLoading: supabaseLoading } = useSession();
  const location = useLocation();
  if (cookieLoading || supabaseLoading) return <div style={{ padding: 16 }}>Loading…</div>;
  if (!cookieUser && !supabaseUser) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}

function AppShellRoute({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <AppShell currentPath={location.pathname} showSimulate>{children}</AppShell>;
}

const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/matches', element: <AppShellRoute><MatchesPage /></AppShellRoute> },
  { path: '/matches/:matchId', element: <AppShellRoute><MatchReplayPage /></AppShellRoute> },
  { path: '/lobby', element: <ProtectedRoute><AppShellRoute><LobbyPage /></AppShellRoute></ProtectedRoute> },
  { path: '/tables/:tableId', element: <ProtectedRoute><AppShellRoute><TablePage /></AppShellRoute></ProtectedRoute> },
  { path: '/agents', element: <ProtectedRoute><AppShellRoute><AgentsPage /></AppShellRoute></ProtectedRoute> },
  { path: '/agents/new', element: <ProtectedRoute><AppShellRoute><AgentEditPage mode="new" /></AppShellRoute></ProtectedRoute> },
  { path: '/agents/:agentId/edit', element: <ProtectedRoute><AppShellRoute><AgentEditPage mode="edit" /></AppShellRoute></ProtectedRoute> },
  { path: '/simulate', element: <ProtectedRoute><AppShellRoute><SimulatePage /></AppShellRoute></ProtectedRoute> },
  { path: '/werewolf', element: <AppShellRoute><WerewolfLobbyPage /></AppShellRoute> },
  { path: '/werewolf/:gameId', element: <AppShellRoute><WerewolfRoomPage /></AppShellRoute> },
  { path: '/', element: <Navigate to="/werewolf" replace /> },
  { path: '*', element: <Navigate to="/werewolf" replace /> },
];

export const router = createBrowserRouter(routes);
