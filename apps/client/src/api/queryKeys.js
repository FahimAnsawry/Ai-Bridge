export const queryKeys = {
  authStatus: () => ['auth', 'status'],
  status: () => ['dashboard', 'status'],
  logs: (filters = {}) => ['logs', filters],
  modelDistribution: () => ['dashboard', 'model-distribution'],
  config: () => ['config'],
  copilotAuthStatus: () => ['copilot', 'auth', 'status'],
  adminUsers: () => ['admin', 'users'],
  adminStats: () => ['admin', 'stats'],
};
