import React from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

interface NavItem {
  to: string;
  label: string;
  icon: React.JSX.Element;
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

function LogoutIcon(): React.JSX.Element {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  );
}

const navItems: NavItem[] = [
  { to: '/traces', label: 'Traces', icon: <TracesIcon /> },
  { to: '/cost', label: 'Cost', icon: <CostIcon /> },
  { to: '/alerts', label: 'Alerts', icon: <AlertsIcon /> },
  { to: '/projects', label: 'Projects', icon: <ProjectsIcon /> },
];

const pageTitles: Record<string, string> = {
  '/traces': 'Traces',
  '/cost': 'Cost',
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

  // Read from localStorage at render time (not build-time env var)
  const projectId = localStorage.getItem('agentlens_project_id') ?? '';
  const shortId = projectId ? projectId.slice(0, 8) + '...' : '(not set)';

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

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 space-y-0.5">
          {navItems.map((item) => (
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
        </nav>

        {/* Project ID + Logout */}
        <div className="px-4 py-3 border-t border-gray-800 space-y-2">
          <div>
            <p className="text-xs text-gray-600 mb-0.5">Project</p>
            <p className="text-xs text-gray-400 font-mono truncate" title={projectId}>{shortId}</p>
          </div>
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
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Project:</span>
            <span className="text-xs text-gray-400 font-mono" title={projectId}>{shortId}</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
