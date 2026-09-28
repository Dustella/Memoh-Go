/**
 * Local isolation scope. Every cached entity, outbox entry and checkpoint is
 * keyed by all three parts: self-hosted deployments share the same default
 * team id, so team_id alone never identifies a scope.
 */
export type Scope = Readonly<{
  /** Normalised deployment origin, e.g. `https://memoh.example.com`. */
  deployment: string;
  accountId: string;
  teamId: string;
}>;

export type ScopeKey = string & { readonly __brand: 'ScopeKey' };

/** Normalise a user-entered server address into a stable origin. */
export function normaliseDeployment(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Unsupported deployment scheme: ${url.protocol}`);
  }
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host.toLowerCase()}${path}`;
}

export function scopeKey(scope: Scope): ScopeKey {
  if (!scope.deployment || !scope.accountId || !scope.teamId) {
    throw new Error('Scope requires deployment, accountId and teamId');
  }
  return [scope.deployment, scope.accountId, scope.teamId]
    .map(encodeURIComponent)
    .join('|') as ScopeKey;
}

export function sameScope(a: Scope, b: Scope): boolean {
  return scopeKey(a) === scopeKey(b);
}
