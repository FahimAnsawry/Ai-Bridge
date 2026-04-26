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
  return res.json();
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

/** GET /api/models */
export async function fetchModels() {
  return handleResponse(await fetch(`${BASE}/models`));
}

/** GET /api/models/offerings */
export async function fetchModelOfferings() {
  return handleResponse(await fetch(`${BASE}/models/offerings`));
}

/** POST /api/models/sync */
export async function syncModels() {
  return handleResponse(
    await fetch(`${BASE}/models/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

/** GET /api/admin/users */
export async function fetchUsers() {
  return handleResponse(await fetch(`${BASE}/admin/users`));
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
