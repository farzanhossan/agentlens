import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import type { LiveFeedEntry } from '../lib/types';
import { timeAgo } from '../lib/timeago';

const WS_URL = (import.meta.env['VITE_WS_URL'] as string | undefined) ?? '';
const MAX_ENTRIES = 200;

const selectClass =
  'bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-500';

function truncate(str: string | undefined, max: number): string {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function formatLatency(ms: number | undefined): string {
  if (ms == null) return '—';
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatCost(cost: number | undefined): string {
  if (cost == null) return '—';
  return `$${cost.toFixed(4)}`;
}

function formatTokens(entry: LiveFeedEntry): string {
  const total = (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0);
  return total > 0 ? total.toLocaleString() : '—';
}

type StatusFilter = 'all' | 'errors';

interface TimestampedEntry extends LiveFeedEntry {
  _receivedAt: number;
}

export function LiveFeedPage(): React.JSX.Element {
  const navigate = useNavigate();
  const socketRef = useRef<Socket | null>(null);

  const [feed, setFeed] = useState<TimestampedEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const bufferRef = useRef<TimestampedEntry[]>([]);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [modelFilter, setModelFilter] = useState<string>('');

  // Rate tracking: timestamps of events in the last 5 seconds
  const eventTimestampsRef = useRef<number[]>([]);
  const [callsPerSec, setCallsPerSec] = useState<number>(0);

  // Tick counter to force re-render for relative timestamps
  const [, setTick] = useState(0);

  // Known models for model dropdown
  const [knownModels, setKnownModels] = useState<Set<string>>(new Set());

  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const handleEntry = useCallback((entry: LiveFeedEntry) => {
    const stamped: TimestampedEntry = { ...entry, _receivedAt: Date.now() };

    // Track for rate calculation
    eventTimestampsRef.current.push(Date.now());

    // Track models
    if (entry.model) {
      setKnownModels((prev) => {
        if (prev.has(entry.model!)) return prev;
        const next = new Set(prev);
        next.add(entry.model!);
        return next;
      });
    }

    if (pausedRef.current) {
      bufferRef.current.push(stamped);
    } else {
      setFeed((prev) => [stamped, ...prev].slice(0, MAX_ENTRIES));
    }
  }, []);

  // Connect WebSocket
  useEffect(() => {
    const socket = io(WS_URL + '/ws/traces', {
      auth: { token: localStorage.getItem('agentlens_token') ?? '' },
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('subscribe-live-feed');
    });

    socket.on('span-completed', (entry: LiveFeedEntry) => {
      handleEntry(entry);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [handleEntry]);

  // Tick every 5s for rate tracking + timestamp freshness
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const cutoff = now - 5000;
      eventTimestampsRef.current = eventTimestampsRef.current.filter((t) => t > cutoff);
      setCallsPerSec(eventTimestampsRef.current.length / 5);
      setTick((t) => t + 1);
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const handlePauseResume = useCallback(() => {
    if (pausedRef.current) {
      // Resuming: flush buffer into feed
      const buffered = [...bufferRef.current];
      bufferRef.current = [];
      setFeed((prev) => [...buffered.reverse(), ...prev].slice(0, MAX_ENTRIES));
      setPaused(false);
    } else {
      setPaused(true);
    }
  }, []);

  // Filtered view
  const visibleFeed = feed.filter((entry) => {
    if (statusFilter === 'errors' && entry.status !== 'error') return false;
    if (modelFilter && entry.model !== modelFilter) return false;
    return true;
  });

  const now = Date.now();

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Live indicator */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
          <span className="text-sm font-semibold text-green-400 tracking-wide">Live</span>
        </div>

        {/* Rate */}
        <span className="text-xs text-gray-400 shrink-0">
          <span className="text-gray-100 font-mono">{callsPerSec.toFixed(1)}</span>
          {' '}calls/sec
        </span>

        <div className="flex-1" />

        {/* Filters */}
        <select
          className={selectClass}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
        >
          <option value="all">All</option>
          <option value="errors">Errors Only</option>
        </select>

        <select
          className={selectClass}
          value={modelFilter}
          onChange={(e) => setModelFilter(e.target.value)}
        >
          <option value="">All Models</option>
          {[...knownModels].sort().map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        {/* Pause/Resume */}
        <button
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            paused
              ? 'bg-brand-500 hover:bg-brand-600 text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
          }`}
          onClick={handlePauseResume}
        >
          {paused ? (
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                  clipRule="evenodd"
                />
              </svg>
              Resume{bufferRef.current.length > 0 ? ` (${bufferRef.current.length})` : ''}
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              Pause
            </span>
          )}
        </button>
      </div>

      {/* Paused banner */}
      {paused && (
        <div className="flex items-center gap-2 bg-yellow-900/30 border border-yellow-700/50 rounded-lg px-4 py-2 text-sm text-yellow-300">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Feed paused — buffering {bufferRef.current.length} new event{bufferRef.current.length !== 1 ? 's' : ''}
        </div>
      )}

      {/* Feed */}
      <div className="flex flex-col gap-px overflow-y-auto flex-1 rounded-xl border border-gray-800 bg-gray-900">
        {visibleFeed.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-gray-600">
            <svg className="w-10 h-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M5 12h14M12 5l7 7-7 7" />
            </svg>
            <p className="text-sm">Waiting for span events…</p>
          </div>
        ) : (
          visibleFeed.map((entry, idx) => {
            const isError = entry.status === 'error';
            const isNewest = idx === 0;
            const ageMs = now - entry._receivedAt;
            const opacityClass =
              ageMs > 30_000 ? 'opacity-50' : ageMs > 20_000 ? 'opacity-70' : '';

            return (
              <div
                key={entry.spanId}
                onClick={() => void navigate(`/traces/${entry.traceId}`)}
                className={[
                  'flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-gray-800/60 transition-colors',
                  'border-l-2',
                  isError
                    ? 'border-l-red-500 bg-red-950/20'
                    : isNewest
                    ? 'border-l-brand-500'
                    : 'border-l-transparent',
                  opacityClass,
                ].join(' ')}
              >
                {/* Timestamp */}
                <span className="min-w-[55px] text-xs text-gray-500 shrink-0 whitespace-nowrap">
                  {timeAgo(entry.startedAt)}
                </span>

                {/* Status pill */}
                <span
                  className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    isError
                      ? 'bg-red-500/20 text-red-400'
                      : 'bg-green-500/20 text-green-400'
                  }`}
                >
                  {entry.status}
                </span>

                {/* Span name */}
                <span className="font-mono text-xs text-brand-400 shrink-0 whitespace-nowrap max-w-[140px] truncate">
                  {entry.name}
                </span>

                {/* Model */}
                {entry.model && (
                  <span className="text-xs text-gray-500 shrink-0 whitespace-nowrap max-w-[100px] truncate">
                    {entry.model}
                  </span>
                )}

                {/* Input preview */}
                <span
                  className={`flex-1 text-xs truncate ${
                    isError ? 'text-red-400' : 'text-gray-400'
                  }`}
                  title={entry.input ?? undefined}
                >
                  {entry.input ? truncate(entry.input, 80) : <span className="text-gray-600">—</span>}
                </span>

                {/* Token count */}
                <span className="font-mono text-xs text-gray-400 shrink-0 whitespace-nowrap w-16 text-right">
                  {formatTokens(entry)}
                </span>

                {/* Latency */}
                <span className="font-mono text-xs text-gray-400 shrink-0 whitespace-nowrap w-14 text-right">
                  {formatLatency(entry.latencyMs)}
                </span>

                {/* Cost */}
                <span className="font-mono text-xs text-gray-400 shrink-0 whitespace-nowrap w-16 text-right">
                  {formatCost(entry.costUsd)}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Footer count */}
      {visibleFeed.length > 0 && (
        <div className="text-xs text-gray-600 text-right">
          Showing {visibleFeed.length} of {feed.length} entries (max {MAX_ENTRIES})
        </div>
      )}
    </div>
  );
}
