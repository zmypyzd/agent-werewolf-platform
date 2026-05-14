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
import { WerewolfHomeResolver } from './pages/WerewolfHomeResolver.js';

// Toggle to re-expose the poker module + agent-config CRUD UI + replay list +
// simulate batch form. When false, those routes redirect to /werewolf so the
// public surface is werewolf-only (per product direction May 2026). All page
// components are still imported and tree-shaken back in by a single flip.
const ENABLE_LEGACY_MODULES = false;

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
  return <AppShell currentPath={location.pathname}>{children}</AppShell>;
}

const legacyRoutes: RouteObject[] = ENABLE_LEGACY_MODULES
  ? [
      { path: '/matches', element: <AppShellRoute><MatchesPage /></AppShellRoute> },
      { path: '/matches/:matchId', element: <AppShellRoute><MatchReplayPage /></AppShellRoute> },
      { path: '/lobby', element: <ProtectedRoute><AppShellRoute><LobbyPage /></AppShellRoute></ProtectedRoute> },
      { path: '/tables/:tableId', element: <ProtectedRoute><AppShellRoute><TablePage /></AppShellRoute></ProtectedRoute> },
      { path: '/agents', element: <ProtectedRoute><AppShellRoute><AgentsPage /></AppShellRoute></ProtectedRoute> },
      { path: '/agents/new', element: <ProtectedRoute><AppShellRoute><AgentEditPage mode="new" /></AppShellRoute></ProtectedRoute> },
      { path: '/agents/:agentId/edit', element: <ProtectedRoute><AppShellRoute><AgentEditPage mode="edit" /></AppShellRoute></ProtectedRoute> },
      { path: '/simulate', element: <ProtectedRoute><AppShellRoute><SimulatePage /></AppShellRoute></ProtectedRoute> },
    ]
  : [
      // Quiet redirects keep deep links from external systems alive while the
      // legacy modules are hidden — they all land on the werewolf home.
      { path: '/matches', element: <Navigate to="/" replace /> },
      { path: '/matches/:matchId', element: <Navigate to="/" replace /> },
      { path: '/lobby', element: <Navigate to="/" replace /> },
      { path: '/tables/:tableId', element: <Navigate to="/" replace /> },
      { path: '/agents', element: <Navigate to="/" replace /> },
      { path: '/agents/new', element: <Navigate to="/" replace /> },
      { path: '/agents/:agentId/edit', element: <Navigate to="/" replace /> },
      { path: '/simulate', element: <Navigate to="/" replace /> },
    ];

const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  ...legacyRoutes,
  { path: '/werewolf', element: <AppShellRoute><WerewolfLobbyPage /></AppShellRoute> },
  { path: '/werewolf/:gameId', element: <AppShellRoute><WerewolfRoomPage /></AppShellRoute> },
  { path: '/', element: <AppShellRoute><WerewolfHomeResolver /></AppShellRoute> },
  { path: '*', element: <Navigate to="/" replace /> },
];

export const router = createBrowserRouter(routes);
