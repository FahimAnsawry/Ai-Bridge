# AI Proxy WebApp

AI Proxy WebApp is a local proxy server and dashboard that acts as a bridge for AI API requests (like Kilo Code, Cline, etc.) to an external API provider. It intercepts your requests seamlessly while offering an intuitive React dashboard for API key management, real-time logging, and system configurations.

## Prerequisites

Before you begin, ensure you have the following installed on your machine:
- **Node.js** (v18.x or later recommended)
- **npm** (comes with Node.js)

## Setup Guide

Follow this step-by-step guide to get the local proxy and dashboard up and running.

### Step 1: Install Server Dependencies

First, from the root of the project (`ai-proxy-webapp`), install the dependencies necessary for the backend Express server:

```bash
npm install
```

### Step 2: Install Client Dependencies

Next, install the dependencies for the React frontend:

```bash
npm install --prefix apps/client
```

### Step 3: Run the Application

The project is equipped with the `concurrently` package to easily run both the server and the frontend client simultaneously with a single command. 

From the root directory, run:

```bash
npm run dev
```

This command executes two scripts at the same time:
1. `npm run start` - Starts the backend Express server on `http://localhost:3000`.
2. `npm run client` - Starts the Vite React dashboard on `http://localhost:5174`.

### Step 4: Access the Dashboard

Once the services are active, check your terminal for the exact Vite frontend URL. Open that URL in your web browser. From the UI dashboard, you can:
- **Overview**: See server status and traffic charts.
- **Settings**: Manage your upstream provider settings, including SwiftRouter's OpenAI-compatible base URL and API key, plus your local intercept key.
- **Logs**: Monitor incoming AI proxy requests in real-time.

### Configuration file (`config.json`)

The application automatically creates and manages a `config.json` file in the root directory. It stores your local API key, your provider's API key, base URL, and port settings. You can edit this manually or securely through the React dashboard "Settings" page while the application is running, and changes are applied immediately.

## SwiftRouter Model Sync

This app supports live model sync from SwiftRouter so you do not need to manually maintain a static model list.

- Startup auto-sync: on server boot, if a `swiftrouter` provider exists with an API key, the server pulls `/models` and refreshes `custom_models`.
- Manual sync: open the dashboard Models page and click **Sync SwiftRouter Models** to refresh immediately.
- Offerings panel: the Models page shows provider and category summary (chat/vision/code) plus last sync time.

### Requirements

- A provider entry with `id: "swiftrouter"`
- Valid SwiftRouter API key in Settings
- Reachable base URL (default: `https://api.swiftrouter.com/v1`)

## SwiftRouter OpenAI-Compatible Setup

Use SwiftRouter exactly like an OpenAI-compatible provider.

- Base URL: `https://api.swiftrouter.com/v1`
- Auth header: `Authorization: Bearer <YOUR_SWIFTROUTER_API_KEY>`
- Default Claude model: `claude-sonnet-4.6`
- Stronger reasoning model: `claude-opus-4.6`

If your app already uses the OpenAI SDK, you usually only need to change `baseURL`, use your SwiftRouter API key, and set `model` to one of the Claude IDs above.

### JavaScript / TypeScript Example

```ts
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.SWIFTROUTER_API_KEY,
  baseURL: "https://api.swiftrouter.com/v1",
});

const response = await client.chat.completions.create({
  model: "claude-sonnet-4.6",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Summarize this article in 5 bullet points." },
  ],
});

console.log(response.choices[0]?.message?.content);
```

Use Opus instead with:

```ts
model: "claude-opus-4.6"
```

### Raw `fetch` Example

```ts
const response = await fetch("https://api.swiftrouter.com/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.SWIFTROUTER_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "claude-sonnet-4.6",
    messages: [
      { role: "user", content: "Explain event-driven architecture simply." },
    ],
  }),
});

const data = await response.json();
console.log(data);
```

### Environment Variables

```env
SWIFTROUTER_API_KEY=your_key_here
OPENAI_BASE_URL=https://api.swiftrouter.com/v1
OPENAI_API_KEY=your_key_here
```

### Useful Endpoints

- `POST /v1/chat/completions`
- `GET /v1/models`
- `GET /v1/account/quota`

### Model Guidance

- `claude-sonnet-4.6`: best default for most app features, chat, coding, and cost/performance balance
- `claude-opus-4.6`: use when you want the strongest reasoning and are okay with higher cost and latency

### Troubleshooting

- `401`: missing or invalid API key
- model not found or request rejected: check the model name is exactly `claude-sonnet-4.6` or `claude-opus-4.6`
- existing OpenAI app not working: verify you changed the provider `baseURL` to `https://api.swiftrouter.com/v1`

Keep `SWIFTROUTER_API_KEY` on your server or API route. Do not expose it directly in browser-only frontend code.

## Example: VS Code Extension Configuration

To use this local proxy in your VS Code extension (e.g., Kilo Code / Cline):
1. Set the **API Base URL** to `http://localhost:3000/v1`
2. Set the **API Key** to your **Local AI Proxy Key** (found in your dashboard settings, defaulting to `local-my-secret-key`).

Your extension will now route requests through the local proxy to your actual provider!

## Troubleshooting Claude CLI Issues

If you're experiencing issues with Claude CLI not working with the proxy, follow these debugging steps:

### Quick Diagnosis

Run the automated diagnostic script:

```bash
node quick-diagnose.js
```

This will test:
1. Basic connection to the proxy
2. Non-streaming /messages endpoint
3. Streaming /messages endpoint
4. SSE event structure validation
5. Upstream configuration check

### Detailed Debugging

For detailed debugging, start the proxy with debug logging:

```bash
npm start
```

The proxy will now log all incoming requests and SSE events.

Then run:

```bash
# Test SSE output format
node test-sse.js

# Compare with real Anthropic API (requires ANTHROPIC_API_KEY env var)
export ANTHROPIC_API_KEY="your-key-here"
node test-sse.js --compare
```

### Testing with Claude CLI

```bash
# Set Claude CLI to use your proxy
export ANTHROPIC_BASE_URL="http://localhost:3000/v1"
export ANTHROPIC_API_KEY="local-my-secret-key"

# Run with verbose output
claude --verbose "Hello world"
```

For more detailed debugging instructions, see `CLAUDE_CLI_DEBUGGING.md`.
