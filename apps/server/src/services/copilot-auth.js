/**
 * services/copilot-auth.js
 *
 * GitHub OAuth Device Flow for GitHub Copilot access.
 * Stores the durable GitHub OAuth token in the Provider collection so
 * Copilot auth survives process restarts like the other providers.
 */

const https = require('https');
const { mongoose, Provider } = require('../config/db');

const GITHUB_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';
const SCOPES = 'read:user copilot';

const COPILOT_PROVIDER_ID = 'copilot';
const COPILOT_PROVIDER_NAME = 'GitHub Copilot';
const COPILOT_PROVIDER_BASE_URL = process.env.COPILOT_PROVIDER_BASE_URL || 'http://localhost:3000/copilot/v1';

const authStateByUser = new Map();
const authAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 20,
  maxFreeSockets: 5,
  timeout: 60_000,
});

function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

function toUserKey(userId) {
  return userId ? userId.toString() : 'default';
}

function toObjectId(userId) {
  if (!userId) return null;
  return userId instanceof mongoose.Types.ObjectId
    ? userId
    : new mongoose.Types.ObjectId(userId.toString());
}

function getRuntimeState(userId) {
  const key = toUserKey(userId);
  if (!authStateByUser.has(key)) {
    authStateByUser.set(key, {
      hydrated: false,
      githubAccessToken: null,
      copilotToken: null,
      copilotTokenExp: 0,
      deviceFlowState: null,
    });
  }
  return authStateByUser.get(key);
}

async function hydrateState(userId) {
  const state = getRuntimeState(userId);
  if (state.hydrated || !userId || !isDbConnected()) {
    state.hydrated = true;
    return state;
  }

  const provider = await Provider.findOne({
    userId: toObjectId(userId),
    providerId: COPILOT_PROVIDER_ID,
  }).select('copilotAuth').lean();

  if (provider?.copilotAuth) {
    state.githubAccessToken = provider.copilotAuth.githubAccessToken || null;
    state.copilotToken = provider.copilotAuth.copilotToken || null;
    state.copilotTokenExp = Number(provider.copilotAuth.copilotTokenExp || 0);
  }

  state.hydrated = true;
  return state;
}

async function persistState(userId, state, user = null) {
  if (!userId || !isDbConnected()) return;

  const update = {
    name: COPILOT_PROVIDER_NAME,
    baseUrl: COPILOT_PROVIDER_BASE_URL,
    'copilotAuth.githubAccessToken': state.githubAccessToken || null,
    'copilotAuth.copilotToken': state.copilotToken || null,
    'copilotAuth.copilotTokenExp': state.copilotTokenExp || 0,
    'copilotAuth.updatedAt': new Date(),
  };

  if (user?.accessKey) {
    update.apiKey = user.accessKey;
    update.apiKeys = [user.accessKey];
  }

  await Provider.updateOne(
    {
      userId: toObjectId(userId),
      providerId: COPILOT_PROVIDER_ID,
    },
    {
      $set: update,
      $setOnInsert: {
        userId: toObjectId(userId),
        providerId: COPILOT_PROVIDER_ID,
        isActive: true,
      },
    },
    { upsert: true }
  );
}

function httpsPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = typeof body === 'string' ? body : JSON.stringify(body);

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      agent: authAgent,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...headers,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = data.startsWith('{')
            ? JSON.parse(data)
            : Object.fromEntries(new URLSearchParams(data));
          resolve({ status: res.statusCode, data: parsed });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      agent: authAgent,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'ai-bridge/1.0 (github-copilot-proxy)',
        ...headers,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function startDeviceFlow(userId) {
  const state = await hydrateState(userId);
  const body = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    scope: SCOPES,
  }).toString();

  const { status, data } = await httpsPost(GITHUB_DEVICE_CODE_URL, body, {
    'Accept': 'application/json',
  });

  if (status !== 200 || !data.device_code) {
    throw new Error(`GitHub Device Flow init failed (${status}): ${JSON.stringify(data)}`);
  }

  state.deviceFlowState = {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval || 5,
    startedAt: Date.now(),
  };

  console.log(`[copilot-auth] Device flow started for ${toUserKey(userId)}. User code: ${data.user_code}`);
  return state.deviceFlowState;
}

async function pollDeviceFlow(userId, user = null) {
  const state = await hydrateState(userId);
  if (!state.deviceFlowState) {
    throw new Error('No active device flow. Call startDeviceFlow() first.');
  }

  const body = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    device_code: state.deviceFlowState.deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  }).toString();

  const { data } = await httpsPost(GITHUB_TOKEN_URL, body, {
    'Accept': 'application/json',
  });

  if (data.error === 'authorization_pending') {
    return { status: 'pending' };
  }

  if (data.error === 'slow_down') {
    state.deviceFlowState.interval += 5;
    return { status: 'slow_down', interval: state.deviceFlowState.interval };
  }

  if (data.error === 'expired_token') {
    state.deviceFlowState = null;
    return { status: 'expired' };
  }

  if (data.error) {
    throw new Error(`Device flow polling error: ${data.error_description || data.error}`);
  }

  if (!data.access_token) {
    throw new Error(`Unexpected poll response: ${JSON.stringify(data)}`);
  }

  state.githubAccessToken = data.access_token;
  state.copilotToken = null;
  state.copilotTokenExp = 0;
  state.deviceFlowState = null;
  await persistState(userId, state, user);
  console.log(`[copilot-auth] GitHub OAuth token acquired for ${toUserKey(userId)}.`);

  try {
    const copilotToken = await fetchCopilotToken(userId, user);
    return { status: 'success', copilotToken };
  } catch (err) {
    state.copilotToken = null;
    state.copilotTokenExp = 0;
    await persistState(userId, state, user);
    console.error('[copilot-auth] Copilot token exchange failed:', err.message);
    return { status: 'token_error', error: err.message };
  }
}

async function fetchCopilotToken(userId, user = null) {
  const state = await hydrateState(userId);
  if (!state.githubAccessToken) {
    throw new Error('No GitHub access token available. Complete Device Flow first.');
  }

  const { status, data } = await httpsGet(COPILOT_TOKEN_URL, {
    'Authorization': `token ${state.githubAccessToken}`,
    'User-Agent': 'ai-bridge/1.0 (github-copilot-proxy)',
    'Editor-Version': 'vscode/1.99.0',
    'Editor-Plugin-Version': 'copilot/1.290.0',
  });

  if (status !== 200 || !data.token) {
    throw new Error(`Failed to get Copilot API token (${status}): ${JSON.stringify(data)}`);
  }

  state.copilotToken = data.token;
  state.copilotTokenExp = (data.expires_at || 0) * 1000;
  await persistState(userId, state, user);
  console.log(`[copilot-auth] Copilot API token refreshed for ${toUserKey(userId)}. Expires: ${new Date(state.copilotTokenExp).toISOString()}`);

  return state.copilotToken;
}

async function getCopilotToken(userId, user = null) {
  const state = await hydrateState(userId);
  const now = Date.now();
  const margin = 2 * 60 * 1000;

  if (state.copilotToken && state.copilotTokenExp > now + margin) {
    return state.copilotToken;
  }

  return fetchCopilotToken(userId, user);
}

async function getAuthStatus(userId) {
  const state = await hydrateState(userId);
  return {
    authenticated: Boolean(state.githubAccessToken),
    hasToken: Boolean(state.githubAccessToken || state.copilotToken),
    tokenExpiry: state.copilotTokenExp ? new Date(state.copilotTokenExp).toISOString() : null,
    deviceFlowActive: Boolean(state.deviceFlowState),
    deviceFlowState: state.deviceFlowState ? {
      userCode: state.deviceFlowState.userCode,
      verificationUri: state.deviceFlowState.verificationUri,
      interval: state.deviceFlowState.interval,
      expiresIn: state.deviceFlowState.expiresIn,
    } : null,
  };
}

async function setGithubToken(userId, token, user = null) {
  const state = await hydrateState(userId);
  state.githubAccessToken = token;
  state.copilotToken = null;
  state.copilotTokenExp = 0;
  await persistState(userId, state, user);
  console.log(`[copilot-auth] GitHub token manually set for ${toUserKey(userId)}.`);
}

async function clearTokens(userId, user = null) {
  const state = await hydrateState(userId);
  state.githubAccessToken = null;
  state.copilotToken = null;
  state.copilotTokenExp = 0;
  state.deviceFlowState = null;
  await persistState(userId, state, user);
  console.log(`[copilot-auth] All tokens cleared for ${toUserKey(userId)}.`);
}

module.exports = {
  startDeviceFlow,
  pollDeviceFlow,
  getCopilotToken,
  getAuthStatus,
  setGithubToken,
  clearTokens,
};
