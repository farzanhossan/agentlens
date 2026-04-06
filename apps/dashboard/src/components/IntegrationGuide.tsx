import React, { useState } from 'react';
import { getProxyUrl } from '../lib/constants';

interface IntegrationGuideProps {
  projectId: string;
}

type Provider = 'openai' | 'anthropic';
type Framework = 'env' | 'python' | 'nodejs' | 'curl';

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
];

const FRAMEWORKS: { id: Framework; label: string }[] = [
  { id: 'env', label: 'Env Variable' },
  { id: 'python', label: 'Python' },
  { id: 'nodejs', label: 'Node.js' },
  { id: 'curl', label: 'cURL' },
];

function getSnippet(provider: Provider, framework: Framework, proxyUrl: string): string {
  if (provider === 'openai') {
    switch (framework) {
      case 'env':
        return `OPENAI_BASE_URL=${proxyUrl}`;
      case 'python':
        return `from openai import OpenAI

client = OpenAI(
    base_url="${proxyUrl}",
    api_key="sk-..."  # your OpenAI key
)

response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello"}]
)`;
      case 'nodejs':
        return `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${proxyUrl}",
  apiKey: "sk-...",  // your OpenAI key
});

const response = await client.chat.completions.create({
  model: "gpt-4",
  messages: [{ role: "user", content: "Hello" }],
});`;
      case 'curl':
        return `curl ${proxyUrl}/chat/completions \\
  -H "Authorization: Bearer sk-..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`;
    }
  } else {
    switch (framework) {
      case 'env':
        return `ANTHROPIC_BASE_URL=${proxyUrl}`;
      case 'python':
        return `from anthropic import Anthropic

client = Anthropic(
    base_url="${proxyUrl}",
    api_key="sk-ant-..."  # your Anthropic key
)

response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}]
)`;
      case 'nodejs':
        return `import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "${proxyUrl}",
  apiKey: "sk-ant-...",  // your Anthropic key
});

const response = await client.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello" }],
});`;
      case 'curl':
        return `curl ${proxyUrl}/messages \\
  -H "x-api-key: sk-ant-..." \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'`;
    }
  }
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
  const [provider, setProvider] = useState<Provider>('openai');
  const [framework, setFramework] = useState<Framework>('env');

  const proxyUrl = getProxyUrl(projectId, provider);
  const snippet = getSnippet(provider, framework, proxyUrl);

  return (
    <div className="mt-4 bg-gray-950 border border-gray-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800">
        <p className="text-xs text-gray-400">
          Route your LLM calls through the AgentLens proxy. Your API key is passed through to the provider — we just observe the traffic.
        </p>
      </div>

      {/* Proxy URL */}
      <div className="px-4 py-3 border-b border-gray-800">
        <label className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">Proxy URL</label>
        <div className="relative mt-1">
          <code className="block text-xs text-brand-400 font-mono bg-gray-900 border border-gray-800 rounded px-3 py-2 pr-16 break-all">
            {proxyUrl}
          </code>
          <CopyButton text={proxyUrl} />
        </div>
      </div>

      {/* Provider tabs */}
      <div className="flex border-b border-gray-800">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            onClick={() => setProvider(p.id)}
            className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 ${
              provider === p.id
                ? 'text-brand-400 border-brand-500'
                : 'text-gray-500 border-transparent hover:text-gray-300'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Framework tabs */}
      <div className="flex border-b border-gray-800 bg-gray-900/50">
        {FRAMEWORKS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFramework(f.id)}
            className={`px-3 py-1.5 text-[11px] font-medium transition-colors ${
              framework === f.id
                ? 'text-gray-100 bg-gray-800'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Code snippet */}
      <div className="relative">
        <pre className="p-4 text-xs text-gray-300 font-mono overflow-auto max-h-64 leading-relaxed">
          {snippet}
        </pre>
        <CopyButton text={snippet} />
      </div>
    </div>
  );
}
