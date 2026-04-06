import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { SpanNode } from '../lib/types';

const WS_URL = (import.meta.env['VITE_WS_URL'] as string | undefined) ??
  (import.meta.env['VITE_API_URL'] as string | undefined) ?? '';

export function useTraceSocket(traceId: string, enabled: boolean): { liveSpans: SpanNode[] } {
  const [liveSpans, setLiveSpans] = useState<SpanNode[]>([]);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const socket = io(WS_URL + '/ws/traces', {
      auth: { token: localStorage.getItem('agentlens_token') ?? '' },
    });
    socketRef.current = socket;

    socket.emit('subscribe-trace', { traceId });
    socket.on('span-added', (span: SpanNode) => {
      setLiveSpans((prev) => [...prev, span]);
    });

    return (): void => {
      socket.emit('unsubscribe-trace', { traceId });
      socket.disconnect();
    };
  }, [traceId, enabled]);

  return { liveSpans };
}
