import React, { useEffect, useRef } from 'react';
import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';
import 'prismjs/components/prism-json';
import type { SpanNode } from '../lib/types';
import { StatusBadge } from './StatusBadge';

export interface SpanDetailPanelProps {
  span: SpanNode | null;
  onClose: () => void;
}

function tryFormatJson(value: string | null): string {
  if (!value) return '';
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function CodeBlock({ content, language }: { content: string | null; language: string }): React.JSX.Element {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (ref.current) {
      Prism.highlightElement(ref.current);
    }
  }, [content]);

  if (!content) {
    return <span className="text-gray-500 text-sm italic">—</span>;
  }

  return (
    <pre className="overflow-auto rounded-lg bg-gray-950 text-xs max-h-64 p-0 m-0">
      <code ref={ref} className={`language-${language}`}>
        {language === 'json' ? tryFormatJson(content) : content}
      </code>
    </pre>
  );
}

export function SpanDetailPanel({ span, onClose }: SpanDetailPanelProps): React.JSX.Element {
  const isOpen = span !== null;

  // Detect if content looks like JSON
  function detectLanguage(value: string | null): string {
    if (!value) return 'text';
    try {
      JSON.parse(value);
      return 'json';
    } catch {
      return 'text';
    }
  }

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-[600px] bg-gray-900 border-l border-gray-800 z-50 flex flex-col shadow-2xl transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {span && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
              <div className="flex items-center gap-3 overflow-hidden">
                <h2 className="text-base font-semibold text-gray-100 truncate">{span.name}</h2>
              </div>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-100 transition-colors ml-3 shrink-0"
                aria-label="Close panel"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {/* Meta row */}
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status={span.status} />
                {span.latencyMs !== null && (
                  <span className="text-sm text-gray-400">{span.latencyMs}ms</span>
                )}
                {span.costUsd && (
                  <span className="text-sm text-gray-400">${parseFloat(span.costUsd).toFixed(6)}</span>
                )}
                {(span.inputTokens !== null || span.outputTokens !== null) && (
                  <span className="text-sm text-gray-400">
                    {span.inputTokens ?? 0} in / {span.outputTokens ?? 0} out tokens
                  </span>
                )}
              </div>

              {/* Model / Provider */}
              {(span.model ?? span.provider) && (
                <div className="flex gap-4 text-sm">
                  {span.model && (
                    <div>
                      <span className="text-gray-500">Model: </span>
                      <span className="text-gray-200 font-mono">{span.model}</span>
                    </div>
                  )}
                  {span.provider && (
                    <div>
                      <span className="text-gray-500">Provider: </span>
                      <span className="text-gray-200">{span.provider}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Timing */}
              <div className="text-sm text-gray-500 space-y-1">
                <div>
                  <span className="text-gray-500">Started: </span>
                  <span className="text-gray-300">{new Date(span.startedAt).toLocaleString()}</span>
                </div>
                {span.endedAt && (
                  <div>
                    <span className="text-gray-500">Ended: </span>
                    <span className="text-gray-300">{new Date(span.endedAt).toLocaleString()}</span>
                  </div>
                )}
              </div>

              {/* Input */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Input</h3>
                <CodeBlock content={span.input} language={detectLanguage(span.input)} />
              </div>

              {/* Output */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Output</h3>
                <CodeBlock content={span.output} language={detectLanguage(span.output)} />
              </div>

              {/* Metadata */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Metadata</h3>
                {Object.keys(span.metadata).length === 0 ? (
                  <span className="text-gray-500 text-sm italic">—</span>
                ) : (
                  <CodeBlock
                    content={JSON.stringify(span.metadata)}
                    language="json"
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
