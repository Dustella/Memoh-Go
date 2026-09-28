import type { PingResponse } from './capabilities';

/**
 * Oldest Memoh server release the app supports: the first with the durable
 * session runtime (`run_accepted`, admission ledger; Memoh #865).
 *
 * Subject to bump. Raise it here and in contracts/README.md together; this is
 * a compatibility floor only and never enables a capability by itself
 * (see capabilities.ts).
 */
export const MIN_SERVER_VERSION = '0.17.0';

export type ServerCompatibility =
  | Readonly<{ kind: 'supported'; version: string }>
  | Readonly<{ kind: 'too_old'; version: string; minimum: string }>
  /** Not a release version (e.g. `dev`, a fork tag): allowed, shown as unverified. */
  | Readonly<{ kind: 'unverified'; version: string }>
  | Readonly<{ kind: 'not_memoh' }>;

type Semver = readonly [number, number, number];

/** `v0.20.0`, `0.20.0`, `v0.20.0-beta.1` (pre-releases rank below their release). */
function parseRelease(version: string): { core: Semver; pre: boolean } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/.exec(version.trim());
  if (!match) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: Boolean(match[4]) };
}

function compareCore(a: Semver, b: Semver): number {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

export function checkServerCompatibility(ping: PingResponse, minimum = MIN_SERVER_VERSION): ServerCompatibility {
  if (ping.status !== 'ok') return { kind: 'not_memoh' };
  const version = (ping.version ?? '').trim();
  const release = parseRelease(version);
  const floor = parseRelease(minimum);
  if (!floor) throw new Error(`Invalid minimum server version: ${minimum}`);
  if (!release) return { kind: 'unverified', version };

  const order = compareCore(release.core, floor.core);
  if (order < 0 || (order === 0 && release.pre && !floor.pre)) return { kind: 'too_old', version, minimum };
  return { kind: 'supported', version };
}
