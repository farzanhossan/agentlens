import React, { useState, useEffect, useRef } from 'react';
import type { SpanNode } from '../lib/types';
import Prism from 'prismjs';
import 'prismjs/components/prism-json';
import 'prismjs/themes/prism-tomorrow.css';

interface SpanInspectorProps {
  span: SpanNode | null;
}

type Tab = 'io' | 'metadata' | 'raw';

interface ChatMessage {
  role: string;
  content: string;
}

function tryParseChatMessages(input: string): ChatMessage[] | null {
  try {
    const parsed: unknown = JSON.parse(input);
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every(
        (item: unknown) =>
          typeof item === 'object' &&
          item !== null &&
          'role' in item &&
          typeof (item as Record<string, unknown>).role === 'string' &&
          ('content' in item)
      )
    ) {
      return parsed as ChatMessage[];
    }
  } catch {
    // not JSON
  }
  return null;
}

function roleColor(role: string): string {
  switch (role) {
    case 'system':
      return 'text-gray-400';
    case 'user':
      return 'text-blue-400';
    case 'assistant':
      return 'text-green-400';
    default:
      return 'text-gray-300';
  }
}

function CodeBlock({ code, language = 'json' }: { code: string; language?: string }): React.JSX.Element {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (ref.current) {
      Prism.highlightElement(ref.current);
    }
  }, [code]);

  return (
    <pre className="text-xs overflow-auto rounded-lg bg-gray-950 p-3 border border-gray-800 max-h-96">
      <code ref={ref} className={`language-${language}`}>
        {code}
      </code>
    </pre>
  );
}

function copyToClipboard(text: string): void {
  void navigator.clipboard.writeText(text);
}

function TokenBar({ span }: { span: SpanNode }): React.JSX.Element | null {
  const input = span.inputTokens ?? 0;
  const output = span.outputTokens ?? 0;
  const total = input + output;

  if (total === 0 && !span.costUsd && !span.model) return null;

  const inputPct = total > 0 ? (input / total) * 100 : 50;
  const outputPct = total > 0 ? (output / total) * 100 : 50;

  return (
    <div className="space-y-2 p-3 bg-gray-900 border border-gray-800 rounded-lg">
      <div className="flex items-center justify-between text-xs text-gray-400 gap-4 flex-wrap">
        {span.model && (
          <span className="font-mono text-gray-300">{span.model}</span>
        )}
        {total > 0 && (
          <span>{total} tokens</span>
        )}
        {span.inputTokens !== null && (
          <span className="text-blue-400">{span.inputTokens} in</span>
        )}
        {span.outputTokens !== null && (
          <span className="text-green-400">{span.outputTokens} out</span>
        )}
        {span.costUsd && (
          <span className="text-yellow-400">${parseFloat(span.costUsd).toFixed(6)}</span>
        )}
      </div>
      {total > 0 && (
        <div className="flex h-1.5 rounded-full overflow-hidden gap-px">
          <div
            className="bg-blue-500 rounded-l-full"
            style={{ width: `${inputPct}%` }}
          />
          <div
            className="bg-green-500 rounded-r-full"
            style={{ width: `${outputPct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function ChatMessageList({ messages }: { messages: ChatMessage[] }): React.JSX.Element {
  return (
    <div className="space-y-3">
      {messages.map((msg, i) => (
        <div key={i} className="space-y-0.5">
          <div className={`text-[10px] uppercase tracking-widest font-semibold ${roleColor(msg.role)}`}>
            {msg.role}
          </div>
          <div className="text-xs text-gray-200 whitespace-pre-wrap bg-gray-900 border border-gray-800 rounded-lg p-2.5">
            {typeof msg.content === 'string'
              ? msg.content
              : JSON.stringify(msg.content, null, 2)}
          </div>
        </div>
      ))}
    </div>
  );
}

function IOTab({ span }: { span: SpanNode }): React.JSX.Element {
  const chatMessages = span.input ? tryParseChatMessages(span.input) : null;

  return (
    <div className="space-y-4 p-4">
      <TokenBar span={span} />

      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Input</h3>
        {span.input ? (
          chatMessages ? (
            <ChatMessageList messages={chatMessages} />
          ) : (
            <CodeBlock code={span.input} />
          )
        ) : (
          <p className="text-gray-600 text-xs italic">No input</p>
        )}
      </div>

      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Output</h3>
        {span.output ? (
          <CodeBlock code={span.output} />
        ) : (
          <p className="text-gray-600 text-xs italic">No output</p>
        )}
      </div>
    </div>
  );
}

function MetadataTab({ span }: { span: SpanNode }): React.JSX.Element {
  const entries = Object.entries(span.metadata);

  if (entries.length === 0) {
    return (
      <div className="p-4 text-gray-600 text-xs italic">No metadata</div>
    );
  }

  return (
    <div className="p-4">
      <table className="w-full text-xs">
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key} className="border-b border-gray-800 last:border-0">
              <td className="py-2 pr-4 text-gray-400 font-mono align-top w-1/3">{key}</td>
              <td className="py-2 text-gray-200 font-mono break-all">
                {typeof value === 'object'
                  ? JSON.stringify(value, null, 2)
                  : String(value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RawJsonTab({ span }: { span: SpanNode }): React.JSX.Element {
  const json = JSON.stringify(span, null, 2);

  return (
    <div className="p-4 space-y-2">
      <button
        onClick={() => copyToClipboard(json)}
        className="text-xs text-brand-400 hover:text-brand-300 border border-gray-700 rounded px-2 py-1 transition-colors"
      >
        Copy JSON
      </button>
      <CodeBlock code={json} />
    </div>
  );
}

export function SpanInspector({ span }: SpanInspectorProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<Tab>('io');

  if (!span) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-sm">
        Select a span to inspect
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'io', label: 'Input / Output' },
    { id: 'metadata', label: 'Metadata' },
    { id: 'raw', label: 'Raw JSON' },
  ];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
        <span className="text-sm font-semibold text-gray-200 truncate font-mono">{span.name}</span>
        <div className="flex gap-2 shrink-0 ml-2">
          {span.input && (
            <button
              onClick={() => copyToClipboard(span.input!)}
              className="text-[10px] text-gray-400 hover:text-gray-200 border border-gray-700 rounded px-2 py-0.5 transition-colors"
            >
              Copy Input
            </button>
          )}
          {span.output && (
            <button
              onClick={() => copyToClipboard(span.output!)}
              className="text-[10px] text-gray-400 hover:text-gray-200 border border-gray-700 rounded px-2 py-0.5 transition-colors"
            >
              Copy Output
            </button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-800 shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-xs font-medium transition-colors border-b-2 ${
              activeTab === tab.id
                ? 'text-brand-400 border-brand-500'
                : 'text-gray-500 border-transparent hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto min-h-0">
        {activeTab === 'io' && <IOTab span={span} />}
        {activeTab === 'metadata' && <MetadataTab span={span} />}
        {activeTab === 'raw' && <RawJsonTab span={span} />}
      </div>
    </div>
  );
}
