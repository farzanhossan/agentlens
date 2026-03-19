import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { api, createProject } from '../lib/api';

interface AuthResponse {
  token: string;
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function RegisterPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleOrgNameChange(value: string): void {
    setOrgName(value);
    if (!slugEdited) setOrgSlug(toSlug(value));
  }

  function handleSlugChange(value: string): void {
    setSlugEdited(true);
    setOrgSlug(value);
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await api.post<AuthResponse>('/auth/register', {
        orgName,
        orgSlug,
        email,
        password,
      });
      localStorage.setItem('agentlens_token', res.data.token);
      const project = await createProject(orgName);
      localStorage.setItem('agentlens_project_id', project.id);
      navigate('/traces', { replace: true });
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        setError('Email or organization slug already taken.');
      } else if (axios.isAxiosError(err) && err.response?.status === 400) {
        const detail = (err.response.data as { message?: string[] }).message;
        setError(Array.isArray(detail) ? detail[0] : 'Invalid input.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <svg width="32" height="32" viewBox="0 0 28 28" fill="none" style={{ color: '#6366f1' }}>
            <circle cx="14" cy="14" r="13" stroke="currentColor" strokeWidth="1.5" />
            <ellipse cx="14" cy="14" rx="8" ry="5" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="14" cy="14" r="3" fill="currentColor" />
          </svg>
          <span style={styles.logoText}>AgentLens</span>
        </div>

        <h1 style={styles.heading}>Create your account</h1>
        <p style={styles.sub}>Start tracing your AI agents for free</p>

        <form onSubmit={(e) => { void handleSubmit(e); }} style={styles.form}>
          <label style={styles.label}>
            Organization name
            <input
              type="text"
              value={orgName}
              onChange={(e) => handleOrgNameChange(e.target.value)}
              placeholder="Acme Corp"
              required
              minLength={2}
              style={styles.input}
            />
          </label>

          <label style={styles.label}>
            Organization slug
            <input
              type="text"
              value={orgSlug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder="acme-corp"
              required
              minLength={2}
              pattern="[a-z0-9-]+"
              title="Lowercase letters, numbers, and hyphens only"
              style={styles.input}
            />
          </label>

          <label style={styles.label}>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoComplete="email"
              style={styles.input}
            />
          </label>

          <label style={styles.label}>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              required
              minLength={8}
              autoComplete="new-password"
              style={styles.input}
            />
          </label>

          {error && <p style={styles.error}>{error}</p>}

          <button type="submit" disabled={loading} style={styles.btn}>
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p style={styles.footer}>
          Already have an account?{' '}
          <Link to="/login" style={styles.link}>Sign in</Link>
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#030712',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
  },
  card: {
    width: '100%',
    maxWidth: '400px',
    background: '#111827',
    border: '1px solid #1f2937',
    borderRadius: '12px',
    padding: '40px',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '28px',
  },
  logoText: {
    fontSize: '18px',
    fontWeight: 700,
    color: '#f9fafb',
  },
  heading: {
    fontSize: '22px',
    fontWeight: 700,
    color: '#f9fafb',
    marginBottom: '6px',
  },
  sub: {
    fontSize: '14px',
    color: '#6b7280',
    marginBottom: '28px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    fontSize: '14px',
    fontWeight: 500,
    color: '#d1d5db',
  },
  input: {
    padding: '10px 14px',
    background: '#1f2937',
    border: '1px solid #374151',
    borderRadius: '8px',
    color: '#f9fafb',
    fontSize: '14px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  error: {
    fontSize: '13px',
    color: '#ef4444',
    margin: 0,
  },
  btn: {
    padding: '11px',
    background: '#6366f1',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: '4px',
  },
  footer: {
    marginTop: '24px',
    textAlign: 'center',
    fontSize: '14px',
    color: '#6b7280',
  },
  link: {
    color: '#818cf8',
    textDecoration: 'none',
  },
};
