/**
 * EN-01/EN-03: one display state per execution environment, keeping the
 * cases the roadmap requires apart: online, offline, no permission, cannot
 * reach, monitoring not supported, and remote-runtime specific states. The
 * server reports liveness as computed now (`online` + `status` on
 * `/workspace-targets`); there is no heartbeat timestamp, so freshness is
 * when the app last asked (`checkedAt`).
 */
export type EnvState = 'online' | 'offline' | 'revoked' | 'update_required' | 'owner_mismatch' | 'forbidden' | 'unreachable' | 'unknown';

export type TargetView = Readonly<{
  id: string;
  name: string;
  kind: string;
  primary: boolean;
  state: EnvState;
}>;

export function targetState(target: { online?: boolean; status?: string }): EnvState {
  switch (target.status) {
    case 'online':
      return 'online';
    case 'offline':
      return 'offline';
    case 'revoked':
      return 'revoked';
    case 'client_update_required':
      return 'update_required';
    case 'owner_mismatch':
      return 'owner_mismatch';
    default:
      return target.online === true ? 'online' : target.online === false ? 'offline' : 'unknown';
  }
}

export function targetViews(targets: readonly { target_id: string; name: string; kind: string; primary?: boolean; online?: boolean; status?: string }[]): TargetView[] {
  return [...targets]
    .map((t) => ({ id: t.target_id, name: t.name, kind: t.kind, primary: Boolean(t.primary), state: targetState(t) }))
    .sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));
}

/** Map a failed request for environment data to a state instead of an error string. */
export function failureState(status: number): EnvState {
  if (status === 401 || status === 403) return 'forbidden';
  if (status === 0 || status === 503 || status === 502 || status === 504) return 'unreachable';
  return 'unknown';
}

/** The state that sums up a Bot for a list row: its primary target, else the best of the rest. */
export function summaryState(views: readonly TargetView[]): EnvState {
  const primary = views.find((v) => v.primary);
  if (primary) return primary.state;
  if (views.some((v) => v.state === 'online')) return 'online';
  return views[0]?.state ?? 'unknown';
}
