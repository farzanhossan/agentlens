Read the project context: this is AgentLens, an AI agent observability
platform. Stack: NestJS, BullMQ, Redis, PostgreSQL (TypeORM),
Elasticsearch, Cloudflare Workers (Hono.js), React + Vite, TypeScript strict.
Senior backend engineer audience. Production-ready code only.

You are building the AgentLens marketing landing page.

Create apps/landing/index.html — a single self-contained HTML file with
inline CSS and JS. Deploy-ready for Vercel or Netlify with zero dependencies.

---

## Design Requirements

- Dark theme — background #0a0a0a, primary accent #6366f1 (indigo)
- Font: Inter from Google Fonts
- Fully responsive — mobile + desktop
- Smooth scroll between sections
- Fast — no heavy frameworks, pure HTML/CSS/JS
- Looks like a premium developer tool (think Axiom, Resend, Railway)

---

## Sections to Build (in order)

### 1. NAV
- Logo: "AgentLens" with a small eye/lens icon (SVG inline)
- Links: Features, Pricing, Docs, GitHub
- CTA button: "Start Free" → links to #waitlist
- Sticky on scroll, blur backdrop

### 2. HERO
Headline:
  "Never wonder what your AI agent did again."

Subheadline:
  "AgentLens gives you full visibility into every LLM call, every
  decision, every dollar. Debug faster. Ship with confidence."

- Primary CTA: "Start Free — No credit card" → #waitlist
- Secondary CTA: "View Demo →" (smooth scroll to #demo)
- Social proof badge: "Used by 500+ developers · 10M+ LLM calls traced"
- Hero visual: animated terminal/code block showing SDK integration:
  ```
  npm install @agentlens/core @agentlens/openai

  import { AgentLens } from '@agentlens/core'
  import '@agentlens/openai'

  AgentLens.init({ apiKey: 'proj_xxx' })
  // ✓ Every LLM call is now traced
  ```
  Animate the lines appearing one by one with a typing effect

### 3. PROBLEM
Heading: "AI agents fail silently. You deserve to know why."

4 pain cards in a 2x2 grid:
- 🔴 "Your agent returned the wrong answer. You have no idea which step went wrong."
- 💸 "Your OpenAI bill hit $2,000. You can't explain where it went."
- 🐛 "A bug in production. You can't reproduce it because you have no logs."
- 🤯 "5 agents, 3 models. Something broke. Good luck figuring out which one."

Each card: dark border, subtle red/orange left border accent

### 4. FEATURES
Heading: "Everything you need to debug AI agents."

6 feature cards in a 3x2 grid:
- 🔭 Trace Viewer — "See every LLM call in a timeline. Full prompt, full response, exact latency."
- 💰 Cost Analytics — "Token usage broken down by agent, feature, user, model."
- 🚨 Failure Alerts — "Get notified on Slack or email the moment an agent fails."
- ⏪ Session Replay — "Replay any past agent run exactly as it happened."
- 🔒 PII Scrubbing — "Sensitive data auto-masked before it leaves your infra. GDPR ready."
- 🔌 Any Framework — "3 lines to integrate. OpenAI, Anthropic, LangChain, custom."

Each card: hover lift effect, indigo icon

### 5. DEMO (id="demo")
Heading: "Integrate in 60 seconds."

3-step code walkthrough with tabs:
Tab 1 — Install:
```bash
npm install @agentlens/core @agentlens/openai
```

Tab 2 — Init:
```typescript
import { AgentLens } from '@agentlens/core'
AgentLens.init({ apiKey: 'proj_xxx' })
```

Tab 3 — Trace:
```typescript
import '@agentlens/openai'
// done. every call is now traced.
```

Below tabs: "That's it. No YAML. No config files. No agent rewrites."
Syntax highlighted using highlight.js from CDN

### 6. COMPARISON TABLE
Heading: "Why developers choose AgentLens."

Table with columns: Feature | AgentLens | LangSmith | Langfuse | Helicone | Datadog

Rows:
- Any framework support     | ✅ | ❌ LangChain only | ⚠️ | ❌ | ✅
- 3-line setup              | ✅ | ❌ | ❌ | ✅ | ❌
- PII scrubbing built-in    | ✅ | ❌ | ❌ | ❌ | ❌
- Session replay            | ✅ | ✅ | ✅ | ❌ | ❌
- Self-host option          | ✅ | ❌ | ✅ | ❌ | ✅
- Starts at free            | ✅ | ✅ | ✅ | ✅ | ❌
- Price (paid)              | $19/mo | $39/mo | $49/mo | $20/mo | $$$

AgentLens column highlighted in indigo

### 7. PRICING
Heading: "Simple pricing. No surprises."

4 cards side by side:

Free — $0/mo
- 10k traces/month
- 3-day retention
- 1 project
- Community support
CTA: "Start Free"

Starter — $19/mo
- 100k traces/month
- 30-day retention
- 5 projects
- Email alerts
CTA: "Get Started"

Pro — $79/mo (MOST POPULAR badge)
- 1M traces/month
- 90-day retention
- Unlimited projects
- PII scrub + Session replay
- Slack alerts
CTA: "Get Started"

Enterprise — Custom
- Unlimited traces
- Self-host option
- SSO + SLA
- Dedicated support
CTA: "Contact Us"

Pro card: indigo border, glowing shadow

### 8. WAITLIST (id="waitlist")
Heading: "Start debugging your AI agents today."
Sub: "Free forever for small projects. No credit card required."

Email input + "Create Free Account" button
- On submit: POST to /api/waitlist with { email }
- Show success message: "🎉 You're on the list! We'll be in touch soon."
- Show error if invalid email
- Store in localStorage to prevent duplicate submissions

Trust badges below form:
"🔒 SOC2 in progress  ·  ✅ GDPR ready  ·  🚫 Data never sold"

### 9. FOOTER
- Logo + tagline: "Full visibility into every AI decision."
- Links: GitHub, Twitter, Email
- "Built by Farzan Hossan"
- Copyright © 2025 AgentLens

---

## Animations & Polish

- Hero headline: fade-in-up on load
- Feature cards: stagger fade-in on scroll (Intersection Observer)
- Pricing cards: scale-up on hover
- Nav: blur/darken on scroll
- Terminal hero block: typewriter effect
- CTA buttons: subtle shimmer/glow on hover

---

## Technical Requirements

- Single file: index.html
- All CSS inline in <style> tag
- All JS inline in <script> tag
- highlight.js from cdnjs for code blocks
- Inter font from Google Fonts
- No jQuery, no React, no build step
- Meta tags: og:title, og:description, og:image, twitter:card
- Google Analytics placeholder: <!-- GA_TAG_HERE -->
- Place file at: apps/landing/index.html

Output the complete file. No placeholders. Every section fully implemented.
