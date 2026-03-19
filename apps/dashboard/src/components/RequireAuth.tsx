import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';

export function RequireAuth(): React.JSX.Element {
  const token = localStorage.getItem('agentlens_token');
  if (!token) return <Navigate to="/login" replace />;
  return <Outlet />;
}
