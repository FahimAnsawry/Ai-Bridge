export const queryKeys = {
  authStatus: () => ['auth', 'status'],
  status: () => ['dashboard', 'status'],
  logs: (filters = {}) => ['logs', filters],
  modelDistribution: () => ['dashboard', 'model-distribution'],
  config: () => ['config'],
  copilotAuthStatus: () => ['copilot', 'auth', 'status'],
  adminUsers: () => ['admin', 'users'],
  adminStats: () => ['admin', 'stats'],
  chatMessages: (threadId) => ['chat', 'messages', threadId],
  chatThreads: () => ['chat', 'threads'],
  models: () => ['dashboard', 'models'],
};
