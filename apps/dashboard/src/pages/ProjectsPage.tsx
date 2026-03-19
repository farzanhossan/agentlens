import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listProjects,
  createProject,
  deleteProject,
  rotateProjectKey,
  type ProjectResponse,
  type ProjectWithKey,
} from '../lib/api';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function CopyIcon(): React.JSX.Element {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function CopyableKey({ value }: { value: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  function copy(): void {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex items-center gap-2 bg-gray-950 border border-gray-700 rounded-md px-3 py-2 mt-2">
      <code className="flex-1 text-xs text-green-400 font-mono break-all">{value}</code>
      <button onClick={copy} className="shrink-0 text-gray-400 hover:text-gray-100 transition-colors">
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  );
}

// ── Create Project Modal ──────────────────────────────────────────────────────

function CreateProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (p: ProjectWithKey) => void;
}): React.JSX.Element {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => createProject(name.trim()),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      onCreated(p);
    },
    onError: () => setError('Failed to create project. Try again.'),
  });

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    if (name.trim().length < 2) { setError('Name must be at least 2 characters.'); return; }
    setError('');
    mutation.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-gray-100 mb-4">New Project</h2>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Project name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My AI Agent"
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-brand-500"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-gray-100 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={mutation.isPending}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm rounded-md transition-colors">
              {mutation.isPending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── New Key Banner ────────────────────────────────────────────────────────────

function NewKeyBanner({ apiKey, onDismiss }: { apiKey: string; onDismiss: () => void }): React.JSX.Element {
  return (
    <div className="bg-yellow-900/40 border border-yellow-600/50 rounded-lg p-4 mb-6">
      <p className="text-sm font-medium text-yellow-300 mb-1">
        Save your API key — it won't be shown again.
      </p>
      <CopyableKey value={apiKey} />
      <button onClick={onDismiss}
        className="mt-3 text-xs text-gray-400 hover:text-gray-100 transition-colors">
        I've saved it, dismiss
      </button>
    </div>
  );
}

// ── Project Row ───────────────────────────────────────────────────────────────

function ProjectRow({
  project,
  isActive,
  onSwitch,
  onRotate,
  onDelete,
}: {
  project: ProjectResponse;
  isActive: boolean;
  onSwitch: () => void;
  onRotate: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className={`bg-gray-900 border rounded-xl p-5 transition-colors ${
      isActive ? 'border-brand-500/60' : 'border-gray-800 hover:border-gray-700'
    }`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-gray-100 truncate">{project.name}</span>
            {isActive && (
              <span className="text-xs bg-brand-600/20 text-brand-400 border border-brand-500/30 px-2 py-0.5 rounded-full">
                Active
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 font-mono">{project.id}</p>
          <p className="text-xs text-gray-600 mt-1">
            Retention: {project.retentionDays}d &nbsp;·&nbsp; Created {fmtDate(project.createdAt)}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!isActive && (
            <button onClick={onSwitch}
              className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-md transition-colors">
              Switch
            </button>
          )}
          <button onClick={onRotate}
            className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-yellow-900/40 text-gray-300 hover:text-yellow-300 rounded-md transition-colors">
            Rotate Key
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-red-400">Sure?</span>
              <button onClick={onDelete}
                className="text-xs px-2 py-1 bg-red-800/50 hover:bg-red-700 text-red-300 rounded-md transition-colors">
                Yes
              </button>
              <button onClick={() => setConfirmDelete(false)}
                className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-md transition-colors">
                No
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)}
              className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-red-900/40 text-gray-300 hover:text-red-400 rounded-md transition-colors">
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ProjectsPage(): React.JSX.Element {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState(
    () => localStorage.getItem('agentlens_project_id') ?? '',
  );

  const { data: projects = [], isLoading, isError } = useQuery({
    queryKey: ['projects'],
    queryFn: listProjects,
  });

  const rotateMutation = useMutation({
    mutationFn: (projectId: string) => rotateProjectKey(projectId),
    onSuccess: (result) => {
      setNewKey(result.apiKey);
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (projectId: string) => deleteProject(projectId),
    onSuccess: (_r, projectId) => {
      if (activeProjectId === projectId) {
        localStorage.removeItem('agentlens_project_id');
        setActiveProjectId('');
      }
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  function switchProject(id: string): void {
    localStorage.setItem('agentlens_project_id', id);
    setActiveProjectId(id);
    // Force reload so all queries re-run with the new project context
    window.location.href = '/traces';
  }

  function handleCreated(p: ProjectWithKey): void {
    localStorage.setItem('agentlens_project_id', p.id);
    setActiveProjectId(p.id);
    setNewKey(p.apiKey);
    setShowCreate(false);
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-100">Projects</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage your projects and API keys</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-md transition-colors"
        >
          + New Project
        </button>
      </div>

      {newKey && (
        <NewKeyBanner apiKey={newKey} onDismiss={() => setNewKey(null)} />
      )}

      {isLoading && (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-5 animate-pulse h-24" />
          ))}
        </div>
      )}

      {isError && (
        <p className="text-sm text-red-400">Failed to load projects.</p>
      )}

      {!isLoading && !isError && projects.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <p className="text-sm">No projects yet.</p>
          <button onClick={() => setShowCreate(true)} className="mt-2 text-sm text-brand-400 hover:text-brand-300 transition-colors">
            Create your first project
          </button>
        </div>
      )}

      <div className="space-y-3">
        {projects.map((p) => (
          <ProjectRow
            key={p.id}
            project={p}
            isActive={p.id === activeProjectId}
            onSwitch={() => switchProject(p.id)}
            onRotate={() => rotateMutation.mutate(p.id)}
            onDelete={() => deleteMutation.mutate(p.id)}
          />
        ))}
      </div>

      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
