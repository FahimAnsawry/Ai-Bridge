# Plan: Multi-Account GitHub Copilot with Auto-Switch on Rate Limit

## Context

The current `copilot-auth.js` and `copilot-proxy.js` support **one GitHub Copilot account per user**. When that account hits a rate limit (429), there is no automatic fallback — the user gets an error. Multiple GitHub Copilot accounts (e.g., personal + work) would each require a separate OAuth flow, but only one can be active at a time today.

**Goal**: Let users connect multiple GitHub Copilot accounts (each with its own GitHub OAuth token → Copilot token chain). On a 429, automatically try the next account.

---

## Architecture

### Data Model Changes — `Provider` schema (`apps/server/src/models/provider.js`)

Add a `copilotCredentials` array so one Provider document can hold multiple account sets (each with its own `githubAccessToken` + `copilotToken` + expiry):

```
copilotCredentials: [
  {
    id: 'copilot-cred-1',        // unique within this provider
    name: 'Personal',            // label shown in UI
    githubAccessToken: String,
    copilotToken: String,
    copilotTokenExp: Number,
    updatedAt: Date,
    isActive: Boolean,
    priority: Number,            // lower = tried first
  },
  ...
]
```

Keep existing `copilotAuth` for backward compatibility during migration.

### Credential Manager — new `copilot-credentials.js`

Refactor `copilot-auth.js` to expose per-credential operations. One `CopilotCredentialManager` instance per `(providerDoc, userId)`.

Key operations:
- `getCredential(userId, credentialId)` — fetch a specific credential
- `getActiveCredential(userId, providerDoc)` — pick first active credential by priority
- `getCopilotTokenForCredential(userId, cred)` — exchange or refresh the copilot token
- `addCredential(userId, credentialId, name, githubAccessToken)` — store a new account
- `removeCredential(userId, credentialId)`
- `setCredentialActive(userId, credentialId, active)`
- `reorderPriorities(userId, orderedIds)` — change priority order

Each credential is stored as a subdocument in `Provider.copilotCredentials`.

### Rate Limit Auto-Switch — in `copilot-proxy.js`

In `proxyCopilotRequest`:

1. Call `credentialManager.getActiveCredential(userId, providerDoc)` → `credential`
2. Make the request with `credential.copilotToken`
3. On 429 (rate limit): mark this credential as exhausted (`isActive: false`? or track in `req.__triedCopilotCreds`) and call the next credential
4. If all credentials exhausted, fall through to error response (429)

**Tracking across retries**: use `req.__triedCopilotCreds: Set<string>` (credential IDs that hit rate limit this session) and `req.__copilotCredIndex` for the next credential to try.

### API Routes — settings endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/providers/:providerId/copilot-credentials` | GET | List all credentials for this provider |
| `/api/providers/:providerId/copilot-credentials` | POST | Add a new GitHub OAuth token (starts Device Flow or accepts PAT) |
| `/api/providers/:providerId/copilot-credentials/:credId` | DELETE | Remove a credential |
| `/api/providers/:providerId/copilot-credentials/:credId/activate` | POST | Set as active / reorder priority |
| `/api/providers/:providerId/copilot-credentials/:credId/switch` | POST | Force switch to this credential |

### UI — Settings Panel

In the Copilot provider settings card:
- "Connected Accounts" section listing each credential with name, status, expiry
- "Add another account" button → triggers OAuth Device Flow for the new account
- Per-account: activate/deactivate, remove
- When sending a request: show which account was used in logs

---

## Implementation Tasks

### Phase 1 — Schema & Data Layer
- [ ] Extend `Provider` schema: add `copilotCredentials` subdocument array
- [ ] Write migration: move single `copilotAuth` into `copilotCredentials[0]` if exists
- [ ] `loadConfig()` in `config.js` must expose `copilotCredentials` from provider docs

### Phase 2 — Credential Manager (`copilot-credentials.js`)
- [ ] New module: `CopilotCredentialManager` class
- [ ] `getActiveCredential(userId, providerDoc)` — select by priority
- [ ] `getCopilotTokenForCredential(userId, cred)` — existing logic from `copilot-auth.js`, adapted
- [ ] `addCredential()` / `removeCredential()` / `reorderPriorities()`
- [ ] `refreshCredential(userId, cred)` — refresh copilot token before expiry (2 min margin)

### Phase 3 — Proxy Integration (`copilot-proxy.js`)
- [ ] Modify `proxyCopilotRequest()` to accept a credential (or credentialId)
- [ ] On 429: find next available credential, retry
- [ ] Track `req.__triedCopilotCreds` across retries
- [ ] If all exhausted: return 429 with message listing which accounts were tried

### Phase 4 — API Routes
- [ ] `GET /api/providers/:providerId/copilot-credentials`
- [ ] `POST /api/providers/:providerId/copilot-credentials` — OAuth Device Flow start
- [ ] `POST /api/providers/:providerId/copilot-credentials/poll` — poll Device Flow
- [ ] `DELETE /api/providers/:providerId/copilot-credentials/:credId`
- [ ] `POST /api/providers/:providerId/copilot-credentials/:credId/activate`

### Phase 5 — UI
- [ ] Settings page: list connected accounts with name, expiry, status
- [ ] "Add Account" → OAuth flow with UI showing device code
- [ ] Per-account actions: activate, deactivate, remove
- [ ] Request logs show which Copilot account was used

---

## Key Trade-offs

| Decision | Chosen | Rejected | Reason |
|---|---|---|---|
| Where to store multiple credentials | Subdocuments in `Provider` doc | Separate `CopilotCredential` collection | Keeps provider-centric design; one provider = one set of Copilot accounts sharing the same API endpoint |
| Credential vs Provider | Credential is a sub-key within the Copilot provider | Separate Provider per account | Sharing the `/copilot/v1` base URL means no need for multiple provider entries |
| Auto-switch trigger | 429 + `Retry-After` header | Hard daily quota check | 429 is the reliable signal; proactive quota tracking adds complexity |

---

## Risks

1. **GitHub Copilot 429 ambiguity**: Some 429s are per-IP, others per-account. After switching credentials the rate limit may still hit. Mitigation: log which credential was used; expose "quota exhausted" state in UI.
2. **Token expiry during a streaming request**: A copilot token could expire mid-stream. The proxy does not currently detect this mid-stream. Mitigation: set a generous expiry margin (5 min) and refresh proactively.
3. **OAuth Device Flow UX**: The device flow requires user to visit github.com and enter a code. If user has 5 accounts, connecting each requires 5 manual steps. Mitigation: provide a "paste PAT" shortcut for users who have a GitHub Personal Access Token.
4. **Backward compatibility**: Existing users with `copilotAuth` populated need a seamless migration. The migration step (Phase 1) converts existing single-account state to the new array format transparently.

---

## Verification

- [ ] Single account: existing flow unchanged (OAuth → token stored → request works)
- [ ] Multiple accounts: connect 2 accounts, hit 429 on first → auto-switch to second → success
- [ ] UI: settings page shows both accounts with correct status
- [ ] Stream: 429 mid-stream triggers switch, remaining tokens stream from new account
- [ ] Migration: existing user with `copilotAuth` sees their account in the new credential list without re-auth