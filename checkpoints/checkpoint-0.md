# Checkpoint 0 — Multi-Copilot Accounts Plan

- Turn: 0
- Status: plan-done
- Plan file: `plans/plan-current-task.md`
- Created: plan for multi-account GitHub Copilot support with auto-switch on 429
- Files examined: copilot-proxy.js (297 lines), copilot-auth.js (343 lines), provider.js (23 lines), proxy.js (1944 lines), config.js (369 lines)
- Key findings:
  - copilot-auth uses single `copilotAuth.githubAccessToken` → `copilotAuth.copilotToken` chain per user
  - copilot-proxy uses `getCopilotToken(req.user._id, req.user)` directly
  - proxy.js already has 429 retry with API key rotation (lines 1825-1846) — will model credential rotation on that pattern
  - Provider model supports `apiKeys[]` array for multi-key rotation — `copilotAccounts` array mirrors this design
- Architecture: `copilotAccounts` array in single `providerId: 'copilot'` Provider doc
- Next: implementation (Phase 1: schema)