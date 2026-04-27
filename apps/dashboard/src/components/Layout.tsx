import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listProjects, fetchSystemHealth, type ProjectResponse } from '../lib/api';
import type { SystemHealth } from '../lib/types';

interface NavItem {
  to: string;
  label: string;
  icon: React.JSX.Element;
}

function OverviewIcon(): React.JSX.Element {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  );
}

function LiveFeedIcon(): React.JSX.Element {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

function TracesIcon(): React.JSX.Element {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}

function CostIcon(): React.JSX.Element {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function AlertsIcon(): React.JSX.Element {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  );
}

function ProjectsIcon(): React.JSX.Element {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  );
}

function ChevronUpDownIcon(): React.JSX.Element {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4M8 15l4 4 4-4" />
    </svg>
  );
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg className="w-3.5 h-3.5 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function ProjectSelector({ activeProjectId, onSwitch }: {
  activeProjectId: string;
  onSwitch: (id: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: projects } = useQuery<ProjectResponse[]>({
    queryKey: ['projects'],
    queryFn: listProjects,
    staleTime: 30_000,
  });

  const activeProject = projects?.find((p) => p.id === activeProjectId);
  const label = activeProject?.name ?? activeProjectId.slice(0, 8) + '...';

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
  }, []);

  useEffect(() => {
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, handleClickOutside]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full gap-2 px-3 py-2 rounded-md text-sm text-gray-300 hover:bg-gray-800 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <ProjectsIcon />
          <span className="truncate font-medium">{label}</span>
        </div>
        <ChevronUpDownIcon />
      </button>

      {open && projects && (
        <div className="absolute bottom-full left-0 right-0 mb-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 max-h-64 overflow-y-auto">
          <div className="px-3 py-2 border-b border-gray-700">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Projects</p>
          </div>
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => { onSwitch(p.id); setOpen(false); }}
              className={`flex items-center justify-between w-full px-3 py-2.5 text-sm transition-colors ${
                p.id === activeProjectId
                  ? 'bg-brand-600/10 text-brand-400'
                  : 'text-gray-300 hover:bg-gray-700'
              }`}
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{p.name}</p>
                <p className="text-xs text-gray-500 font-mono truncate">{p.id.slice(0, 12)}...</p>
              </div>
              {p.id === activeProjectId && <CheckIcon />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LogoutIcon(): React.JSX.Element {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  );
}

function HealthIndicator(): React.JSX.Element {
  const { data } = useQuery<SystemHealth>({
    queryKey: ['system-health'],
    queryFn: fetchSystemHealth,
    refetchInterval: 60_000,
    retry: 1,
  });

  const esUp = data?.elasticsearch === 'connected';
  const dotColor = esUp ? 'bg-green-500' : 'bg-yellow-500';
  const label = esUp ? 'Systems OK' : 'Degraded';
  const tooltip = esUp
    ? 'All systems operational'
    : 'Elasticsearch unavailable — analytics falling back to database';

  return (
    <div className="px-5 py-2 border-b border-gray-800" title={tooltip}>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${dotColor} shrink-0`} />
        <span className="text-xs text-gray-500">{label}</span>
      </div>
    </div>
  );
}

const mainNavItems: NavItem[] = [
  { to: '/overview', label: 'Overview', icon: <OverviewIcon /> },
  { to: '/traces', label: 'Traces', icon: <TracesIcon /> },
  { to: '/live', label: 'Live Feed', icon: <LiveFeedIcon /> },
  { to: '/cost', label: 'Cost', icon: <CostIcon /> },
  { to: '/alerts', label: 'Alerts', icon: <AlertsIcon /> },
];

const bottomNavItems: NavItem[] = [
  { to: '/projects', label: 'Projects', icon: <ProjectsIcon /> },
];

const pageTitles: Record<string, string> = {
  '/overview': 'Overview',
  '/traces': 'Traces',
  '/live': 'Live Feed',
  '/cost': 'Cost',
  '/traces/compare': 'Compare Traces',
  '/alerts/history': 'Alert History',
  '/alerts': 'Alerts',
  '/projects': 'Projects',
};

function usePageTitle(): string {
  const { pathname } = useLocation();
  for (const [prefix, title] of Object.entries(pageTitles)) {
    if (pathname.startsWith(prefix)) return title;
  }
  return 'AgentLens';
}

export function Layout(): React.JSX.Element {
  const pageTitle = usePageTitle();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [projectId, setProjectId] = useState(
    () => localStorage.getItem('agentlens_project_id') ?? ''
  );
  const shortId = projectId ? projectId.slice(0, 8) + '...' : '(not set)';

  function switchProject(id: string): void {
    localStorage.setItem('agentlens_project_id', id);
    setProjectId(id);
    queryClient.invalidateQueries();
  }

  function handleLogout(): void {
    localStorage.removeItem('agentlens_token');
    localStorage.removeItem('agentlens_project_id');
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      {/* Sidebar */}
      <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col shrink-0">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-gray-800">
          <span className="text-lg font-bold text-brand-500 tracking-tight">AgentLens</span>
        </div>

        {/* Health indicator */}
        <HealthIndicator />

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 flex flex-col">
          <div className="space-y-0.5">
            {mainNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-brand-600/20 text-brand-500 border-l-2 border-brand-500 pl-[10px]'
                      : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'
                  }`
                }
              >
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </div>
          <div className="mt-auto pt-3 border-t border-gray-800 space-y-0.5">
            {bottomNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-brand-600/20 text-brand-500 border-l-2 border-brand-500 pl-[10px]'
                      : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'
                  }`
                }
              >
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>

        {/* Project selector + Logout */}
        <div className="px-2 py-3 border-t border-gray-800 space-y-1">
          <ProjectSelector activeProjectId={projectId} onSwitch={switchProject} />
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-gray-400 hover:text-gray-100 hover:bg-gray-800 transition-colors"
          >
            <LogoutIcon />
            Logout
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header className="h-12 bg-gray-900 border-b border-gray-800 flex items-center px-6 shrink-0">
          <span className="text-sm font-semibold text-gray-200 flex-1">{pageTitle}</span>
          <span className="text-xs text-gray-500 font-mono" title={projectId}>{shortId}</span>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
