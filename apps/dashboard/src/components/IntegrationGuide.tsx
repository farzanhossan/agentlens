import React, { useState } from 'react';
import { getIngestEndpoint } from '../lib/constants';

interface IntegrationGuideProps {
  projectId: string;
}

function CopyButton({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  function copy(): void {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={copy}
      className="absolute top-2 right-2 text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

export function IntegrationGuide({ projectId }: IntegrationGuideProps): React.JSX.Element {
  const installCmd = 'npm i @farzanhossans/agentlens';
  const endpoint = getIngestEndpoint();
  const initSnippet = `import { AgentLens } from '@farzanhossans/agentlens';

AgentLens.init({
  apiKey: '${projectId}',
  endpoint: '${endpoint}',
});

// Done. Every call to OpenAI, Anthropic, Gemini, Cohere, or Mistral
// from this app is now traced — no other code changes needed.`;

  return (
    <div className="mt-4 bg-gray-950 border border-gray-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800">
        <p className="text-xs text-gray-400">
          Drop in <code className="text-brand-400">@farzanhossans/agentlens</code>. Every call to OpenAI, Anthropic, Gemini, Cohere, or Mistral from this project is traced automatically — no client wrappers, no code changes inside your call sites.
        </p>
      </div>

      {/* Install */}
      <div className="px-4 py-3 border-b border-gray-800">
        <label className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">1. Install</label>
        <div className="relative mt-1">
          <code className="block text-xs text-brand-400 font-mono bg-gray-900 border border-gray-800 rounded px-3 py-2 pr-16 break-all">
            {installCmd}
          </code>
          <CopyButton text={installCmd} />
        </div>
      </div>

      {/* Init */}
      <div className="px-4 py-3 border-b border-gray-800">
        <label className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">
          2. Add one line at app startup
        </label>
        <div className="relative mt-1">
          <pre className="text-xs text-gray-300 font-mono bg-gray-900 border border-gray-800 rounded px-3 py-2 pr-16 overflow-auto max-h-72 leading-relaxed whitespace-pre">
            {initSnippet}
          </pre>
          <CopyButton text={initSnippet} />
        </div>
      </div>

      {/* Footer hint */}
      <div className="px-4 py-2 text-[11px] text-gray-500">
        Python and other languages are coming soon. For now you can use the per-provider SDKs (<code className="text-gray-400">@farzanhossans/agentlens-openai</code>, <code className="text-gray-400">@farzanhossans/agentlens-anthropic</code>) or the <code className="text-gray-400">agentlens</code> Python package.
      </div>
    </div>
  );
}
