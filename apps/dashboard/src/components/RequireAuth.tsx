import React, { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { listProjects } from '../lib/api';

export function RequireAuth(): React.JSX.Element {
  const token = localStorage.getItem('agentlens_token');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!token) { setReady(true); return; }
    const pid = localStorage.getItem('agentlens_project_id');
    if (pid) { setReady(true); return; }

    // Project ID missing — fetch and store the first project
    listProjects()
      .then((projects) => {
        if (projects.length > 0) {
          localStorage.setItem('agentlens_project_id', projects[0].id);
        }
      })
      .catch(() => { /* ignore — will show empty state */ })
      .finally(() => setReady(true));
  }, [token]);

  if (!token) return <Navigate to="/login" replace />;
  if (!ready) return <></>;
  return <Outlet />;
}
