#!/usr/bin/env node
/**
 * scripts/copilot-setup.js
 *
 * Interactive CLI to set up GitHub Copilot authentication for ai-bridge.
 * Run: node scripts/copilot-setup.js
 *
 * This will:
 *   1. Start the GitHub Device Flow
 *   2. Open the browser to the verification URL (or print it)
 *   3. Poll until you authorize
 *   4. Confirm Copilot API token was fetched
 */

const https = require('https');

const SERVER_BASE = process.env.SERVER_URL || 'http://localhost:3002';
const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY || process.env.AI_BRIDGE_API_KEY || '';

function requestHeaders(extra = {}) {
  return {
    ...(BRIDGE_API_KEY ? { Authorization: `Bearer ${BRIDGE_API_KEY}` } : {}),
    ...extra,
  };
}

function post(path, body = {}) {
  return fetch(`${SERVER_BASE}${path}`, {
    method: 'POST',
    headers: requestHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  }).then((r) => r.json());
}

function get(path) {
  return fetch(`${SERVER_BASE}${path}`, {
    headers: requestHeaders(),
  }).then((r) => r.json());
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  GitHub Copilot Authentication Setup');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Check current status
  const status = await get('/copilot/auth/status').catch(() => null);

  if (status?.hasToken) {
    console.log('✅ Already authenticated with GitHub Copilot!');
    console.log(`   Token expires: ${status.tokenExpiry}`);
    console.log('\nNo action needed. Your ai-bridge is ready.\n');
    return;
  }

  // Start device flow
  console.log('Starting GitHub Device Flow...\n');
  const flow = await post('/copilot/auth/start');

  if (!flow.success) {
    console.error('❌ Failed to start device flow:', flow.error);
    if (!BRIDGE_API_KEY) {
      console.error('   Tip: set BRIDGE_API_KEY when using this script outside the dashboard login session.');
    }
    process.exit(1);
  }

  console.log('┌─────────────────────────────────────────┐');
  console.log(`│  1. Visit: ${flow.verificationUri.padEnd(29)}│`);
  console.log(`│  2. Enter: ${flow.userCode.padEnd(29)}│`);
  console.log('└─────────────────────────────────────────┘');
  console.log(`\n   Code expires in ${flow.expiresIn}s. Polling every ${flow.interval}s...\n`);

  // Try to open browser automatically
  const { exec } = require('child_process');
  exec(`start ${flow.verificationUri}`, () => {}); // Windows

  // Poll for completion
  let attempts = 0;
  const maxAttempts = Math.floor(flow.expiresIn / flow.interval);

  while (attempts < maxAttempts) {
    await sleep(flow.interval * 1000);
    attempts++;

    const poll = await get('/copilot/auth/poll').catch(() => ({ status: 'error' }));

    if (poll.status === 'pending') {
      process.stdout.write(`   Waiting for authorization... (${attempts}/${maxAttempts})\r`);
      continue;
    }

    if (poll.status === 'slow_down') {
      console.log(`\n   [slow_down] GitHub asked us to slow down. Interval: ${poll.interval}s`);
      continue;
    }

    if (poll.status === 'expired') {
      console.error('\n❌ Device code expired. Please run the script again.');
      process.exit(1);
    }

    if (poll.status === 'success') {
      console.log('\n\n✅ Authorization successful!');
      console.log('✅ GitHub Copilot API token fetched and cached.');
      console.log('\nYour ai-bridge Copilot proxy is now ready:\n');
      console.log(`  OpenAI format : ${SERVER_BASE}/copilot/v1/chat/completions`);
      console.log(`  Anthropic fmt : ${SERVER_BASE}/copilot/v1/messages`);
      console.log(`  Models list   : ${SERVER_BASE}/copilot/v1/models`);
      console.log('\nUse your local Bridge API key as the Authorization Bearer token.\n');
      return;
    }

    console.error('\n❌ Unexpected poll response:', poll);
    process.exit(1);
  }

  console.error('\n❌ Timed out waiting for authorization.');
  process.exit(1);
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
