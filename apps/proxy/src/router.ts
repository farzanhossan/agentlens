export interface ProxyRoute {
  projectId: string;
  provider: string;
  upstreamPath: string;
}

const ROUTE_PREFIX = '/v1/p/';

export function parseProxyRoute(path: string): ProxyRoute | null {
  if (!path.startsWith(ROUTE_PREFIX)) return null;

  const rest = path.slice(ROUTE_PREFIX.length);
  const slashIdx = rest.indexOf('/');
  if (slashIdx === -1) return null;

  const projectId = rest.slice(0, slashIdx);
  if (!projectId) return null;

  const afterProject = rest.slice(slashIdx + 1);
  const providerSlash = afterProject.indexOf('/');
  if (providerSlash === -1) return null;

  const provider = afterProject.slice(0, providerSlash);
  const upstreamPath = afterProject.slice(providerSlash);

  if (!provider || !upstreamPath) return null;

  return { projectId, provider, upstreamPath };
}
