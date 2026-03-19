import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { TracesPage } from './pages/TracesPage';
import { TraceDetailPage } from './pages/TraceDetailPage';
import { CostPage } from './pages/CostPage';
import { AlertsPage } from './pages/AlertsPage';
import { ProjectsPage } from './pages/ProjectsPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function RootRedirect(): React.JSX.Element {
  const token = localStorage.getItem('agentlens_token');
  return <Navigate to={token ? '/traces' : '/login'} replace />;
}

export function App(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="login" element={<LoginPage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<Layout />}>
              <Route index element={<RootRedirect />} />
              <Route path="traces" element={<TracesPage />} />
              <Route path="traces/:traceId" element={<TraceDetailPage />} />
              <Route path="cost" element={<CostPage />} />
              <Route path="alerts" element={<AlertsPage />} />
              <Route path="projects" element={<ProjectsPage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
