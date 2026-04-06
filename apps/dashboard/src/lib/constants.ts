export const PROXY_BASE_URL = 'https://api-agentlens.techmatbd.com';

export function getProxyUrl(projectId: string, provider: string): string {
  return `${PROXY_BASE_URL}/v1/p/${projectId}/${provider}/v1`;
}
