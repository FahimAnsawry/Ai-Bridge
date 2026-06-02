/**
 * api.js — Centralized API client
 * All HTTP calls go through here; the Vite proxy forwards /api/* → localhost:3000
 */

const BASE = '/api';

async function handleResponse(res) {
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/** GET /auth/status */
export async function fetchAuthStatus() {
  const res = await fetch(`/auth/status`, { credentials: 'include' });
  if (!res.ok) return { user: null };
  return res.json().catch(() => ({ user: null }));
}

/** GET /api/status */
export async function fetchStatus() {
  return handleResponse(await fetch(`${BASE}/status`));
}

/** GET /api/config */
export async function fetchConfig() {
  return handleResponse(await fetch(`${BASE}/config`));
}

/** POST /api/config */
export async function saveConfig(updates) {
  return handleResponse(
    await fetch(`${BASE}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
  );
}

/** GET /api/logs?model=&status=&limit= */
export async function fetchLogs({ model, status, limit } = {}) {
  const params = new URLSearchParams();
  if (model)  params.set('model', model);
  if (status) params.set('status', String(status));
  if (limit)  params.set('limit', String(limit));
  const qs = params.toString();
  return handleResponse(await fetch(`${BASE}/logs${qs ? `?${qs}` : ''}`));
}

/** DELETE /api/logs */
export async function clearLogs() {
  return handleResponse(await fetch(`${BASE}/logs`, { method: 'DELETE' }));
}

/** GET /api/model-distribution */
export async function fetchModelDistribution() {
  return handleResponse(await fetch(`${BASE}/model-distribution`));
}

/** GET /api/models */
export async function fetchModels() {
  return handleResponse(await fetch(`${BASE}/models`));
}

/** GET /api/models/offerings */
export async function fetchModelOfferings() {
  return handleResponse(await fetch(`${BASE}/models/offerings`));
}

/** POST /api/models/sync */
export async function syncModels({ providerId } = {}) {
  return handleResponse(
    await fetch(`${BASE}/models/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(providerId ? { providerId } : {}),
    })
  );
}

/** GET /api/admin/users */
export async function fetchUsers() {
  return handleResponse(await fetch(`${BASE}/admin/users`));
}

/** GET /api/providers/health */
export async function fetchProviderHealth() {
  return handleResponse(await fetch(`${BASE}/providers/health`));
}

/** GET /api/admin/stats */
export async function fetchGlobalStats() {
  return handleResponse(await fetch(`${BASE}/admin/stats`));
}

/** DELETE /api/admin/users/:id */
export async function deleteUser(id) {
  return handleResponse(await fetch(`${BASE}/admin/users/${id}`, { method: 'DELETE' }));
}

/** PUT /api/admin/users/:id/role */
export async function setUserRole(id, role) {
  return handleResponse(
    await fetch(`${BASE}/admin/users/${id}/role`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
  );
}

export async function regenerateAccessKey() {
  return handleResponse(await fetch(`${BASE}/user/regenerate-key`, {
    method: 'POST'
  }));
}

// ── Chat thread persistence ───────────────────────────────────────────────────

/** GET /api/chat/threads */
export async function fetchChatThreads() {
  return handleResponse(await fetch(`${BASE}/chat/threads`));
}

/** POST /api/chat/threads — create a new thread */
export async function createChatThread({ name, model }) {
  return handleResponse(
    await fetch(`${BASE}/chat/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, model }),
    })
  );
}

/** PUT /api/chat/threads/:id — rename / change model */
export async function updateChatThread(id, { name, model }) {
  return handleResponse(
    await fetch(`${BASE}/chat/threads/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, model }),
    })
  );
}

/** DELETE /api/chat/threads/:id */
export async function deleteChatThread(id) {
  return handleResponse(
    await fetch(`${BASE}/chat/threads/${id}`, { method: 'DELETE' })
  );
}

/** GET /api/chat/messages?threadId= */
export async function fetchChatMessages({ threadId } = {}) {
  const params = threadId ? `?threadId=${threadId}` : '';
  return handleResponse(await fetch(`${BASE}/chat/messages${params}`));
}

/** POST /api/chat/messages — append { role, content, model, threadId } */
export async function appendChatMessage({ role, content, model, threadId }) {
  return handleResponse(
    await fetch(`${BASE}/chat/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, content, model, threadId }),
    })
  );
}

/** PATCH /api/chat/messages/:id — edit a user message */
export async function editChatMessage(id, { content }) {
  return handleResponse(
    await fetch(`${BASE}/chat/messages/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
  );
}

/** DELETE /api/chat/messages — clear with optional threadId body */
export async function clearChatMessages({ threadId } = {}) {
  return handleResponse(
    await fetch(`${BASE}/chat/messages`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(threadId ? { threadId } : {}),
    })
  );
}

/** DELETE /api/chat/messages/:id */
export async function deleteChatMessage(id) {
  return handleResponse(await fetch(`${BASE}/chat/messages/${id}`, { method: 'DELETE' }));
}

// ── GitHub Copilot Auth API ───────────────────────────────────────────────────

/** GET /copilot/auth/status */
export async function fetchCopilotAuthStatus() {
  const res = await fetch('/copilot/auth/status', { credentials: 'include' });
  return res.json();
}

/** POST /copilot/auth/start — begin Device Flow */
export async function startCopilotDeviceFlow() {
  const res = await fetch('/copilot/auth/start', { method: 'POST', credentials: 'include' });
  return res.json();
}

/** GET /copilot/auth/poll — poll for completion */
export async function pollCopilotDeviceFlow() {
  const res = await fetch('/copilot/auth/poll', { credentials: 'include' });
  return res.json();
}

/** POST /copilot/auth/set-token — inject a token manually */
export async function setCopilotToken(token) {
  const res = await fetch('/copilot/auth/set-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ token }),
  });
  return res.json();
}

/** POST /copilot/auth/logout — clear tokens */
export async function logoutCopilot() {
  const res = await fetch('/copilot/auth/logout', { method: 'POST', credentials: 'include' });
  return res.json();
}

/** GET /copilot/v1/models — list available models (needs bridge API key) */
export async function fetchCopilotModels(apiKey) {
  const res = await fetch('/copilot/v1/models', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  return res.json();
}
