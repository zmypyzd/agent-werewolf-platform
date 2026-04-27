import { Navigate, createBrowserRouter, useLocation } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './auth/AuthContext.js';
import { LoginPage } from './pages/LoginPage.js';
import { RegisterPage } from './pages/RegisterPage.js';
import { LobbyPage } from './pages/LobbyPage.js';
import { TablePage } from './pages/TablePage.js';
import { AgentsPage } from './pages/AgentsPage.js';
import { AgentEditPage } from './pages/AgentEditPage.js';
import { MatchesPage } from './pages/MatchesPage.js';
import { MatchReplayPage } from './pages/MatchReplayPage.js';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div style={{ padding: 16 }}>Loading…</div>;
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}

const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/matches', element: <MatchesPage /> },
  { path: '/matches/:matchId', element: <MatchReplayPage /> },
  { path: '/lobby', element: <ProtectedRoute><LobbyPage /></ProtectedRoute> },
  { path: '/tables/:tableId', element: <ProtectedRoute><TablePage /></ProtectedRoute> },
  { path: '/agents', element: <ProtectedRoute><AgentsPage /></ProtectedRoute> },
  { path: '/agents/new', element: <ProtectedRoute><AgentEditPage mode="new" /></ProtectedRoute> },
  { path: '/agents/:agentId/edit', element: <ProtectedRoute><AgentEditPage mode="edit" /></ProtectedRoute> },
  { path: '/', element: <Navigate to="/lobby" replace /> },
  { path: '*', element: <Navigate to="/lobby" replace /> },
];

export const router = createBrowserRouter(routes);
