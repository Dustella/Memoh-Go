/**
 * What the connected server is known to support (contracts/u1-discovery.md).
 *
 * A capability is only ever turned on by evidence: an explicit `/ping`
 * feature, a successful probe, or a server response that can only come from
 * the feature. Version strings are never parsed to guess capabilities.
 * Knowledge is keyed by deployment + version + commit, so an upgraded or
 * downgraded server starts from `unknown` again.
 */
export type Known = 'yes' | 'no' | 'unknown';

export type ServerCapabilities = Readonly<{
  serverKey: string;
  /** `GET /bots/:bot/sessions/:session/invocations/:id` (contracts/u4). */
  invocationLookup: Known;
  /**
   * Admission is idempotent per (session, invocation_id), so resending the
   * same intent can never start a second run. Proven by any `run_accepted`
   * frame: the ack and the durable ledger shipped together (Memoh #865).
   */
  admissionDedup: Known;
}>;

export type PingResponse = Readonly<{
  status?: string;
  version?: string;
  commit_hash?: string;
  features?: readonly string[];
}>;

export function serverKey(deployment: string, ping: PingResponse): string {
  return [deployment.replace(/\/+$/, ''), ping.version ?? '', ping.commit_hash ?? ''].join('|');
}

export function capabilitiesFromPing(deployment: string, ping: PingResponse): ServerCapabilities {
  const features = new Set(ping.features ?? []);
  return {
    serverKey: serverKey(deployment, ping),
    invocationLookup: features.has('invocation_lookup') ? 'yes' : 'unknown',
    admissionDedup: 'unknown',
  };
}

/** Keep what we learned about this exact server build; reset on any change. */
export function reconcileCapabilities(
  stored: ServerCapabilities | undefined,
  fresh: ServerCapabilities,
): ServerCapabilities {
  if (!stored || stored.serverKey !== fresh.serverKey) return fresh;
  return {
    serverKey: fresh.serverKey,
    invocationLookup: fresh.invocationLookup === 'yes' ? 'yes' : stored.invocationLookup,
    admissionDedup: stored.admissionDedup,
  };
}

export function observeRunAccepted(caps: ServerCapabilities): ServerCapabilities {
  return caps.admissionDedup === 'yes' ? caps : { ...caps, admissionDedup: 'yes' };
}

export function observeLookupSupport(caps: ServerCapabilities, supported: boolean): ServerCapabilities {
  const next: Known = supported ? 'yes' : 'no';
  return caps.invocationLookup === next ? caps : { ...caps, invocationLookup: next };
}

/**
 * How to settle a send whose ack was lost:
 * - `lookup`: ask the server (also used to probe while support is unknown).
 * - `resend`: resend the same invocation id; the server deduplicates.
 * - `confirm`: neither is proven, so never resend on our own; ask the user.
 */
export type RecoveryMode = 'lookup' | 'resend' | 'confirm';

export function recoveryMode(caps: ServerCapabilities): RecoveryMode {
  return caps.invocationLookup === 'no' ? fallbackMode(caps) : 'lookup';
}

/** The path used when a lookup is unsupported or gave no usable answer. */
export function fallbackMode(caps: ServerCapabilities): Exclude<RecoveryMode, 'lookup'> {
  return caps.admissionDedup === 'yes' ? 'resend' : 'confirm';
}
