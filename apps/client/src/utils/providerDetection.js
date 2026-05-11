export function isNvidiaNimValue(value) {
  if (!value || typeof value !== 'string') return false;
  const normalized = value.toLowerCase();
  if (normalized.includes('integrate.api.nvidia.com')) return true;

  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.includes('nvidia') ||
    tokens.includes('nvdia') ||
    tokens.includes('nim');
}

export function isNvidiaNimProvider(provider) {
  if (!provider || typeof provider !== 'object') return false;
  return isNvidiaNimValue(provider.id) ||
    isNvidiaNimValue(provider.providerId) ||
    isNvidiaNimValue(provider.name) ||
    isNvidiaNimValue(provider.baseUrl);
}
